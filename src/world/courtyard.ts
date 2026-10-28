import * as THREE from "three";
import type { Phase, SeatId } from "@/game/types";
import { createRng } from "@/lib/rng";
import { CAMERA, frameFor, mixHex, PHASE_LOOKS, ringPositions, wrapLines, type Look, type PhaseLook } from "./layout";

// The Block C courtyard (DESIGN.md §4): the building, the lamp post, and everyone in a ring.
// Framework-free three.js with a small imperative API; the screens own the game state and call
// update() and say(). Low-poly people are the ones from the studio trial, recoloured per persona.

export type CourtyardSeat = {
  id: SeatId;
  name: string;
  flat: string | null;
  look: Look;
  alive: boolean;
  me: boolean;
  /** A second line under the name when the viewer knows it: their own role, a crewmate's, anyone out. */
  role: string | null;
  crewmate: boolean;
};

export type CourtyardState = {
  phase: Phase;
  seats: CourtyardSeat[];
  /** Who points at whom (day). */
  pointers: Record<SeatId, SeatId>;
  /** Votes so far (vote). */
  votes: Record<SeatId, SeatId | "skip">;
  /** Who the light falls on: last night's victim, the vote leader, the voted out. */
  spotlight: SeatId | null;
  /** Seats the viewer can pick right now (night target, point, vote), or null. */
  selectable: SeatId[] | null;
  selected: SeatId | null;
};

export type Courtyard = {
  update(state: CourtyardState): void;
  /** Shows a speech bubble over a seat for a few seconds. */
  say(seat: SeatId, text: string, tone?: "chat" | "crew" | "ghost"): void;
  /** Freezes the animation on the current frame (people, camera, lighting). */
  pause(paused: boolean): void;
  dispose(): void;
};

type Person = {
  seat: CourtyardSeat;
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  arms: [THREE.Group, THREE.Group];
  mouth: THREE.Mesh;
  eyes: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
  ring: THREE.Mesh;
  label: THREE.Sprite | null;
  labelKey: string;
  bubble: THREE.Sprite | null;
  bubbleUntil: number;
  home: { x: number; z: number; facing: number };
  phaseOffset: number;
};

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const AMBER = "#f2b24a";
const CREW = "#ff5fae";
const VOTE = "#ff7a7a";

export function createCourtyard(host: HTMLElement, { onSelect, reducedMotion }: { onSelect(id: SeatId): void; reducedMotion: boolean }): Courtyard {
  const narrow = () => host.clientWidth < 640;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrow() ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "manipulation";
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.1, 120);
  const lookAt = new THREE.Vector3(0, 1.3, 0);
  let seatCount = 8;
  camera.position.set(CAMERA.x, CAMERA.y, CAMERA.z);
  camera.lookAt(lookAt);

  // ── materials and shapes, shared so a dozen people stay cheap ───────────────────────────
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(thing: T) => (disposables.push(thing), thing);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const material = (color: string, roughness = 0.85) => {
    const key = `${color}/${roughness}`;
    if (!materials.has(key)) materials.set(key, keep(new THREE.MeshStandardMaterial({ color, roughness })));
    return materials.get(key)!;
  };
  const boxes = new Map<string, THREE.BoxGeometry>();
  const boxGeometry = (w: number, h: number, d: number) => {
    const key = `${w}/${h}/${d}`;
    if (!boxes.has(key)) boxes.set(key, keep(new THREE.BoxGeometry(w, h, d)));
    return boxes.get(key)!;
  };
  function box(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material | string, shadows = true) {
    const mesh = new THREE.Mesh(boxGeometry(w, h, d), typeof mat === "string" ? material(mat) : mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function cylinder(parent: THREE.Object3D, x: number, y: number, z: number, r: number, h: number, mat: THREE.Material | string, sides = 10) {
    const mesh = new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r, h, sides)), typeof mat === "string" ? material(mat) : mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // ── light ───────────────────────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight("#ffffff", "#000000", 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#ffffff", 1);
  sun.position.set(-8, 16, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const lamp = new THREE.PointLight("#ffc46b", 0, 16, 1.6);
  lamp.position.set(0, 3.3, 0);
  scene.add(lamp);
  const spot = new THREE.SpotLight("#fff3d6", 0, 22, 0.32, 0.45, 1);
  spot.position.set(0, 12, 0);
  scene.add(spot, spot.target);
  const spotDisc = new THREE.Mesh(keep(new THREE.CircleGeometry(0.85, 32)), keep(new THREE.MeshBasicMaterial({ color: "#fff3d6", transparent: true, opacity: 0, depthWrite: false })));
  spotDisc.rotation.x = -Math.PI / 2;
  spotDisc.position.y = 0.03;
  scene.add(spotDisc);

  // ── the courtyard and Block C ───────────────────────────────────────────────────────────
  const groundMat = new THREE.MeshStandardMaterial({ color: "#1a2033", roughness: 1 });
  keep(groundMat);
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(60, 60)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // Paving: a square of slabs around the lamp.
  const slab = material("#3a3f4f", 1);
  for (let x = -6; x <= 6; x += 1.5) for (let z = -6; z <= 6; z += 1.5) box(scene, x, 0.01, z, 1.42, 0.02, 1.42, slab, false);
  // The lamp post and its planter in the middle of the ring.
  cylinder(scene, 0, 0.22, 0, 0.75, 0.44, "#4a4f60", 16);
  cylinder(scene, 0, 0.46, 0, 0.68, 0.06, "#2c4a35", 16);
  cylinder(scene, 0, 1.9, 0, 0.06, 3, "#20242f", 8);
  const lampHead = box(scene, 0, 3.42, 0, 0.42, 0.14, 0.42, "#20242f");
  const bulbMat = keep(new THREE.MeshBasicMaterial({ color: "#ffd37a" }));
  box(lampHead, 0, -0.1, 0, 0.3, 0.05, 0.3, bulbMat, false);

  // The building wraps the back and the left of the courtyard (the camera looks in from the front right).
  const facade = material("#2a3149", 0.95);
  const trim = material("#3b4463", 0.9);
  const block = new THREE.Group();
  scene.add(block);
  box(block, -1, 5, -9.5, 22, 10, 1.2, facade);
  box(block, -11.4, 5, 0, 1.2, 10, 20, facade);
  box(block, -1, 10.1, -9.5, 22.4, 0.3, 1.5, trim);
  box(block, -11.4, 10.1, 0, 1.5, 0.3, 20.4, trim);
  // Windows: one instanced mesh per wall; colour per window shows lit or dark.
  type Pane = { threshold: number };
  const panes: Pane[] = [];
  const windowGeo = keep(new THREE.PlaneGeometry(0.9, 1.2));
  const windowMat = keep(new THREE.MeshBasicMaterial({ color: "#ffffff" }));
  const rng = createRng("block-c/windows");
  const backCount = 4 * 10;
  const sideCount = 4 * 8;
  const windows = new THREE.InstancedMesh(windowGeo, windowMat, backCount + sideCount);
  keep(windows);
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (let floor = 0; floor < 4; floor++) {
    for (let i = 0; i < 10; i++) {
      // Leave a gap above the street door.
      const x = -10 + i * 2 + (i >= 5 ? 1.6 : 0);
      m4.makeTranslation(x, 3.6 + floor * 1.8, -8.88);
      windows.setMatrixAt(n++, m4);
      panes.push({ threshold: rng.next() });
    }
    for (let i = 0; i < 8; i++) {
      m4.makeRotationY(Math.PI / 2).setPosition(-10.78, 3.6 + floor * 1.8, -7 + i * 2);
      windows.setMatrixAt(n++, m4);
      panes.push({ threshold: rng.next() });
    }
  }
  scene.add(windows);
  // Balconies on the back wall.
  for (let floor = 1; floor < 4; floor++) {
    for (const x of [-8, -2, 6]) {
      box(block, x, 2.95 + floor * 1.8, -8.5, 1.6, 0.08, 0.8, trim);
      box(block, x, 3.25 + floor * 1.8, -8.12, 1.6, 0.5, 0.04, material("#1d2233"));
    }
  }
  // The street door, its canopy and the sign.
  box(block, 0, 1.2, -8.85, 1.8, 2.4, 0.1, "#141927");
  box(block, 0, 2.55, -8.5, 2.6, 0.12, 1, trim);
  const sign = textSprite(["BLOCK C"], { font: `700 64px ${FONT}`, color: AMBER, background: "#0b0f1a", padding: 18, letterSpacing: 10 });
  sign.scale.multiplyScalar(0.45);
  sign.position.set(0, 3.05, -8.7);
  scene.add(sign);
  // Things people leave in a courtyard.
  function bench(x: number, z: number, rot: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    box(g, 0, 0.45, 0, 1.6, 0.08, 0.5, "#8a5a3a");
    box(g, 0, 0.75, -0.22, 1.6, 0.4, 0.06, "#8a5a3a");
    for (const dx of [-0.7, 0.7]) box(g, dx, 0.22, 0, 0.08, 0.44, 0.45, "#20242f");
    scene.add(g);
  }
  bench(-7.5, -6.6, 0.4);
  bench(7.2, -5.5, -0.7);
  for (const [x, c] of [
    [4.2, "#2f6e4a"],
    [5.1, "#3b5f9e"],
    [6, "#5a5f6e"],
  ] as const) {
    box(scene, x, 0.55, -8.2, 0.7, 1.1, 0.7, c);
    box(scene, x, 1.13, -8.2, 0.74, 0.06, 0.74, "#20242f");
  }
  for (const [x, z] of [
    [-9.6, 4.5],
    [-9.6, -4],
    [8.5, 7.5],
  ] as const) {
    cylinder(scene, x, 0.35, z, 0.45, 0.7, "#6b4a3a", 10);
    const leaves = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.75, 0)), material("#2f6e4a"));
    leaves.position.set(x, 1.25, z);
    leaves.castShadow = true;
    scene.add(leaves);
  }
  // A bike against the left wall and a couple of takeaway bags by the door.
  const bike = new THREE.Group();
  bike.position.set(-10.3, 0, 6);
  bike.rotation.y = Math.PI / 2;
  for (const dx of [-0.55, 0.55]) {
    const wheel = new THREE.Mesh(keep(new THREE.TorusGeometry(0.34, 0.04, 6, 18)), material("#15181f"));
    wheel.position.set(dx, 0.36, 0);
    bike.add(wheel);
  }
  box(bike, 0, 0.62, 0, 1.1, 0.05, 0.05, "#c94f4f");
  box(bike, 0.3, 0.85, 0, 0.05, 0.45, 0.05, "#c94f4f");
  scene.add(bike);
  for (const [x, c] of [
    [1.3, "#d8c7a1"],
    [1.75, "#b5462f"],
  ] as const) box(scene, x, 0.25, -8.4, 0.38, 0.5, 0.26, c);

  // ── text on canvases ────────────────────────────────────────────────────────────────────
  function textSprite(
    lines: string[],
    { font, color, background, padding = 16, letterSpacing = 0, sub }: { font: string; color: string; background: string | null; padding?: number; letterSpacing?: number; sub?: { text: string; font: string; color: string } },
  ) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const size = (f: string) => Number(/(\d+)px/.exec(f)?.[1] ?? 32);
    ctx.font = font;
    ctx.letterSpacing = `${letterSpacing}px`;
    let width = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (sub) {
      ctx.font = sub.font;
      width = Math.max(width, ctx.measureText(sub.text).width);
    }
    const lineHeight = size(font) * 1.25;
    const subHeight = sub ? size(sub.font) * 1.3 : 0;
    canvas.width = Math.ceil(width + padding * 2);
    canvas.height = Math.ceil(lines.length * lineHeight + subHeight + padding * 2);
    if (background) {
      ctx.fillStyle = background;
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, Math.min(28, canvas.height / 2));
      ctx.fill();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font;
    ctx.letterSpacing = `${letterSpacing}px`;
    ctx.fillStyle = color;
    lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, padding + lineHeight * (i + 0.5)));
    if (sub) {
      ctx.font = sub.font;
      ctx.letterSpacing = "0px";
      ctx.fillStyle = sub.color;
      ctx.fillText(sub.text, canvas.width / 2, padding + lines.length * lineHeight + subHeight / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.renderOrder = 10;
    const scale = 0.0075;
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
    return sprite;
  }
  const disposeSprite = (sprite: THREE.Sprite) => {
    sprite.material.map?.dispose();
    sprite.material.dispose();
    sprite.removeFromParent();
  };

  // ── people ──────────────────────────────────────────────────────────────────────────────
  const people = new Map<SeatId, Person>();
  const ringGeo = keep(new THREE.RingGeometry(0.42, 0.52, 32));
  const discGeo = keep(new THREE.CircleGeometry(0.52, 32));

  function makePerson(seat: CourtyardSeat): Person {
    const { top, skin, hair, hat } = seat.look;
    // Each person gets their own materials so a ghost can fade without fading everyone.
    const own: THREE.MeshStandardMaterial[] = [];
    const mat = (color: string) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true });
      own.push(m);
      return m;
    };
    const topMat = mat(top);
    const skinMat = mat(skin);
    const hairMat = mat(hair);
    const legMat = mat("#2a3040");
    const eyeMat = mat("#1b1f27");
    const mouthMat = mat("#6b3b32");
    const group = new THREE.Group();
    group.userData.seat = seat.id;
    const body = new THREE.Group();
    group.add(body);
    cylinder(body, 0, 0.92, 0, 0.22, 0.56, topMat, 10);
    box(body, 0, 0.62, 0, 0.34, 0.15, 0.26, legMat);
    const head = new THREE.Group();
    head.position.y = 1.46;
    body.add(head);
    const skull = new THREE.Mesh(keep(new THREE.SphereGeometry(0.21, 14, 10)), skinMat);
    skull.scale.y = 1.08;
    skull.castShadow = true;
    head.add(skull);
    const cap = new THREE.Mesh(keep(new THREE.SphereGeometry(0.218, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), hairMat);
    cap.position.y = 0.04;
    head.add(cap);
    if (hat) {
      const beanie = new THREE.Mesh(keep(new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45)), topMat);
      beanie.position.y = 0.07;
      head.add(beanie);
      cylinder(head, 0, 0.09, 0, 0.235, 0.06, topMat, 12);
    }
    const eyes = [-0.075, 0.075].map((x) => box(head, x, 0.02, 0.19, 0.035, 0.045, 0.02, eyeMat, false));
    const mouth = box(head, 0, -0.085, 0.19, 0.08, 0.016, 0.02, mouthMat, false);
    const arms = [-1, 1].map((sign) => {
      const arm = new THREE.Group();
      arm.position.set(sign * 0.29, 1.15, 0);
      box(arm, 0, -0.2, 0, 0.12, 0.42, 0.14, topMat);
      cylinder(arm, 0, -0.44, 0, 0.065, 0.12, skinMat, 8);
      body.add(arm);
      return arm;
    }) as [THREE.Group, THREE.Group];
    for (const sign of [-1, 1]) {
      box(body, sign * 0.11, 0.3, 0, 0.14, 0.5, 0.15, legMat);
      box(body, sign * 0.11, 0.04, 0.05, 0.16, 0.08, 0.26, "#e8e2d4");
    }
    const ring = new THREE.Mesh(ringGeo, keep(new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    group.add(ring);
    // A click target bigger than the body, so people are easy to tap on a phone.
    const hit = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 8)), keep(new THREE.MeshBasicMaterial({ visible: false })));
    hit.position.y = 1.1;
    hit.userData.seat = seat.id;
    group.add(hit);
    scene.add(group);
    return { seat, group, body, head, arms, mouth, eyes, materials: own, ring, label: null, labelKey: "", bubble: null, bubbleUntil: 0, home: { x: 0, z: 0, facing: 0 }, phaseOffset: Math.random() * Math.PI * 2 };
  }

  function removePerson(p: Person) {
    if (p.label) disposeSprite(p.label);
    if (p.bubble) disposeSprite(p.bubble);
    for (const m of p.materials) m.dispose();
    p.group.removeFromParent();
  }

  function refreshLabel(p: Person, phase: Phase) {
    const s = p.seat;
    const name = s.me ? `${s.name} (you)` : s.name;
    const sub = !s.alive ? `out${s.role ? ` · ${s.role}` : ""}` : s.role ? `${s.role}${s.flat ? ` · ${s.flat}` : ""}` : (s.flat ?? "");
    const key = `${name}|${sub}|${s.me}|${s.crewmate}|${s.alive}|${phase === "night"}`;
    if (key === p.labelKey) return;
    p.labelKey = key;
    if (p.label) disposeSprite(p.label);
    const color = s.me ? AMBER : s.crewmate ? CREW : s.alive ? "#eef1f8" : "#a3adc4";
    p.label = textSprite([name], { font: `600 34px ${FONT}`, color, background: "rgba(11,15,26,0.78)", padding: 12, sub: sub ? { text: sub, font: `500 24px ${FONT}`, color: "#a3adc4" } : undefined });
    p.label.position.set(0, 2.2, 0);
    p.group.add(p.label);
  }

  // ── arcs for pointing and votes ─────────────────────────────────────────────────────────
  const arcs = new THREE.Group();
  scene.add(arcs);
  let arcKey = "";
  const coneGeo = keep(new THREE.ConeGeometry(0.1, 0.28, 10));
  const arcMats = { point: keep(new THREE.MeshBasicMaterial({ color: AMBER })), vote: keep(new THREE.MeshBasicMaterial({ color: VOTE })) };
  function rebuildArcs(state: CourtyardState) {
    const pairs: [SeatId, SeatId, "point" | "vote"][] = [];
    if (state.phase === "day") for (const [from, to] of Object.entries(state.pointers)) pairs.push([from, to, "point"]);
    if (state.phase === "vote") for (const [from, to] of Object.entries(state.votes)) if (to !== "skip") pairs.push([from, to, "vote"]);
    const key = JSON.stringify(pairs);
    if (key === arcKey) return;
    arcKey = key;
    for (const child of [...arcs.children]) {
      if (child instanceof THREE.Mesh && child.geometry !== coneGeo) child.geometry.dispose();
      child.removeFromParent();
    }
    for (const [from, to, kind] of pairs) {
      const a = people.get(from)?.home;
      const b = people.get(to)?.home;
      if (!a || !b) continue;
      const start = new THREE.Vector3(a.x, 1.2, a.z);
      const end = new THREE.Vector3(b.x, 1.2, b.z);
      const dir = end.clone().sub(start).normalize();
      start.addScaledVector(dir, 0.45);
      end.addScaledVector(dir, -0.55);
      const mid = start.clone().lerp(end, 0.5).setY(2 + start.distanceTo(end) * 0.12);
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      arcs.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, kind === "vote" ? 0.04 : 0.03, 6), arcMats[kind]));
      const head = new THREE.Mesh(coneGeo, arcMats[kind]);
      head.position.copy(end);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
      arcs.add(head);
    }
  }

  // ── state ───────────────────────────────────────────────────────────────────────────────
  let current: CourtyardState | null = null;
  let lookFrom: PhaseLook = PHASE_LOOKS.night;
  let lookTo: PhaseLook = PHASE_LOOKS.night;
  let lookProgress = 1;
  let shownLook: PhaseLook = PHASE_LOOKS.night;
  let windowShare = -1;

  function mixLook(a: PhaseLook, b: PhaseLook, t: number): PhaseLook {
    const mix = (x: number, y: number) => x + (y - x) * t;
    return {
      sky: mixHex(a.sky, b.sky, t),
      ground: mixHex(a.ground, b.ground, t),
      hemiSky: mixHex(a.hemiSky, b.hemiSky, t),
      hemiGround: mixHex(a.hemiGround, b.hemiGround, t),
      hemi: mix(a.hemi, b.hemi),
      sun: mixHex(a.sun, b.sun, t),
      sunIntensity: mix(a.sunIntensity, b.sunIntensity),
      windows: mix(a.windows, b.windows),
      lamp: mix(a.lamp, b.lamp),
    };
  }
  const lit = new THREE.Color("#ffc46b");
  const unlit = new THREE.Color();
  function applyLook(look: PhaseLook) {
    shownLook = look;
    renderer.setClearColor(look.sky);
    groundMat.color.set(look.ground);
    hemi.color.set(look.hemiSky);
    hemi.groundColor.set(look.hemiGround);
    hemi.intensity = look.hemi;
    sun.color.set(look.sun);
    sun.intensity = look.sunIntensity;
    lamp.intensity = look.lamp;
    bulbMat.color.set(look.lamp > 1 ? "#ffd37a" : "#8a8f9c");
    // Windows switch on one by one as the share changes.
    if (Math.abs(look.windows - windowShare) > 0.01) {
      windowShare = look.windows;
      unlit.set(mixHex("#141a2b", "#6f87a8", Math.min(1, look.hemi / 2.4)));
      panes.forEach((pane, i) => windows.setColorAt(i, pane.threshold < look.windows ? lit : unlit));
      if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    }
  }
  applyLook(PHASE_LOOKS.night);

  function update(state: CourtyardState) {
    dirty = true;
    const previous = current;
    current = state;
    if (!previous || previous.phase !== state.phase) {
      lookFrom = shownLook;
      lookTo = PHASE_LOOKS[state.phase];
      lookProgress = reducedMotion || !previous ? 1 : 0;
      if (lookProgress === 1) applyLook(lookTo);
    }
    // People: add, update or remove to match the seats, then place them in the ring.
    const ids = new Set(state.seats.map((s) => s.id));
    for (const [id, p] of people) {
      if (ids.has(id)) continue;
      removePerson(p);
      people.delete(id);
    }
    if (state.seats.length && state.seats.length !== seatCount) {
      seatCount = state.seats.length;
      resize();
    }
    const front = Math.max(0, state.seats.findIndex((s) => s.me));
    const spots = ringPositions(state.seats.length, front);
    state.seats.forEach((seat, i) => {
      let p = people.get(seat.id);
      if (!p || JSON.stringify(p.seat.look) !== JSON.stringify(seat.look)) {
        if (p) removePerson(p);
        p = makePerson(seat);
        people.set(seat.id, p);
      }
      p.seat = seat;
      p.home = spots[i];
      p.group.position.set(spots[i].x, 0, spots[i].z);
      refreshLabel(p, state.phase);
      const ghost = !seat.alive;
      for (const m of p.materials) {
        m.opacity = ghost ? 0.32 : 1;
        m.depthWrite = !ghost;
      }
      p.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = !ghost && o.material !== p!.ring.material;
      });
      const ringMat = p.ring.material as THREE.MeshBasicMaterial;
      const selected = state.selected === seat.id;
      const selectable = !!state.selectable?.includes(seat.id);
      p.ring.geometry = selected ? discGeo : ringGeo;
      ringMat.color.set(selected ? AMBER : seat.crewmate ? CREW : seat.me ? AMBER : "#eef1f8");
      ringMat.opacity = selected ? 0.55 : seat.me || seat.crewmate ? 0.8 : selectable ? 0.5 : 0;
    });
    rebuildArcs(state);
    const target = state.spotlight ? people.get(state.spotlight) : undefined;
    spot.intensity = target ? 120 : 0;
    (spotDisc.material as THREE.MeshBasicMaterial).opacity = target ? 0.18 : 0;
    if (target) {
      spot.position.set(target.home.x * 0.6, 12, target.home.z * 0.6 + 2);
      spot.target.position.set(target.home.x, 0, target.home.z);
      spotDisc.position.set(target.home.x, 0.03, target.home.z);
    }
    renderer.domElement.style.cursor = "default";
  }

  function say(seat: SeatId, text: string, tone: "chat" | "crew" | "ghost" = "chat") {
    const p = people.get(seat);
    if (!p) return;
    if (p.bubble) disposeSprite(p.bubble);
    const lines = wrapLines(text, narrow() ? 22 : 28, 3);
    const style = {
      chat: { background: "rgba(238,241,248,0.96)", color: "#0b0f1a" },
      crew: { background: "rgba(255,95,174,0.95)", color: "#1a0712" },
      ghost: { background: "rgba(163,173,196,0.55)", color: "#0b0f1a" },
    }[tone];
    p.bubble = textSprite(lines, { font: `500 32px ${FONT}`, ...style, padding: 18 });
    p.bubble.position.set(0, 2.75 + p.bubble.scale.y / 2, 0);
    p.group.add(p.bubble);
    p.bubbleUntil = performance.now() + 3_500 + text.length * 45;
    dirty = true;
  }

  // ── input ───────────────────────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;
  function seatAt(event: PointerEvent): SeatId | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    for (const hit of raycaster.intersectObjects([...people.values()].map((p) => p.group), true)) {
      const id = hit.object.userData.seat as SeatId | undefined;
      if (id && current?.selectable?.includes(id)) return id;
    }
    return null;
  }
  const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) return;
    downAt = null;
    const id = seatAt(e);
    if (id) onSelect(id);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    renderer.domElement.style.cursor = seatAt(e) ? "pointer" : "default";
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onMove);

  // ── size ────────────────────────────────────────────────────────────────────────────────
  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    const { halfW, halfH } = frameFor(seatCount, width / height);
    Object.assign(camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    camera.updateProjectionMatrix();
  }
  const sizeWatcher = new ResizeObserver(resize);
  sizeWatcher.observe(host);
  resize();

  // ── animation ───────────────────────────────────────────────────────────────────────────
  let visible = true;
  let paused = false;
  let dirty = true;
  const visibility = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
  visibility.observe(host);
  let frame = 0;
  let last = performance.now();
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || (paused && !dirty)) return;
    dirty = false;
    if (lookProgress < 1) {
      lookProgress = Math.min(1, lookProgress + dt / 1.6);
      const t = lookProgress * lookProgress * (3 - 2 * lookProgress);
      applyLook(mixLook(lookFrom, lookTo, t));
    }
    const phase = current?.phase ?? "night";
    const seconds = now / 1000;
    for (const p of people.values()) {
      const s = p.seat;
      const asleep = phase === "night" && s.alive && !s.me && !s.crewmate;
      const pointingAt = phase === "day" ? current?.pointers[s.id] : phase === "vote" ? (current?.votes[s.id] as SeatId | undefined) : undefined;
      const target = pointingAt && pointingAt !== "skip" ? people.get(pointingAt) : undefined;
      // Face the middle, or whoever you're accusing.
      const facing = target ? Math.atan2(target.home.x - p.home.x, target.home.z - p.home.z) : p.home.facing;
      p.group.rotation.y = facing;
      p.arms[1].rotation.x = target ? -1.35 : 0;
      p.head.rotation.x = asleep ? 0.45 : 0;
      for (const eye of p.eyes) eye.scale.y = asleep ? 0.2 : 1;
      const talking = p.bubble !== null;
      if (reducedMotion) {
        p.body.position.y = s.alive ? 0 : 0.2;
        p.mouth.scale.y = talking ? 2.5 : 1;
      } else {
        p.body.position.y = s.alive ? Math.sin(seconds * 1.6 + p.phaseOffset) * 0.012 : 0.2 + Math.sin(seconds * 1.3 + p.phaseOffset) * 0.06;
        p.mouth.scale.y = talking ? 1 + Math.abs(Math.sin(seconds * 14 + p.phaseOffset)) * 3 : 1;
        if (!asleep && !target) p.head.rotation.y = Math.sin(seconds * 0.4 + p.phaseOffset) * 0.25;
        p.arms[0].rotation.x = talking ? Math.sin(seconds * 3 + p.phaseOffset) * 0.25 - 0.2 : 0;
      }
      if (p.bubble && now > p.bubbleUntil) {
        disposeSprite(p.bubble);
        p.bubble = null;
      }
      // Keep tags readable: a speaker's tag and bubble draw over everyone else's.
      if (p.label) p.label.renderOrder = talking ? 12 : 10;
    }
    if (!reducedMotion) {
      camera.position.set(CAMERA.x + Math.sin(seconds * 0.12) * 0.6, CAMERA.y, CAMERA.z + Math.cos(seconds * 0.1) * 0.4);
      camera.lookAt(lookAt);
      (spotDisc.material as THREE.MeshBasicMaterial).opacity = spot.intensity > 0 ? 0.15 + Math.sin(seconds * 2) * 0.04 : 0;
    }
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return {
    update,
    say,
    pause(value: boolean) {
      paused = value;
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(frame);
      sizeWatcher.disconnect();
      visibility.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      for (const p of people.values()) removePerson(p);
      people.clear();
      for (const child of [...arcs.children]) if (child instanceof THREE.Mesh && child.geometry !== coneGeo) child.geometry.dispose();
      disposeSprite(sign);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
