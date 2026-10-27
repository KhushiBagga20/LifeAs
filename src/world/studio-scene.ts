import * as THREE from "three";
import type { Mood } from "./story";
import { conversationFraming } from "./camera";
import { agentIds, canWalk, characters, distance, findPath, stations, type AgentId, type LayoutItem, type Point, type StationId } from "./simulation";

export type SceneEvents = {
  position(p: Point): void;
  interact(id: StationId | AgentId): void;
  ready(): void;
};
export type StudioScene = ReturnType<typeof createStudio>;

export function createStudio(host: HTMLElement, events: SceneEvents) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor("#dce5df");
  renderer.domElement.setAttribute("aria-label", "3D design studio. Click the floor to walk, or use WASD. Click a character or workstation to approach and interact.");
  renderer.domElement.tabIndex = 0;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#dce5df", 35, 65);
  const camera = new THREE.OrthographicCamera(-11, 11, 8, -8, 0.1, 90);
  camera.position.set(15, 18, 19);
  camera.lookAt(0, 0, 0);
  const cameraLook = new THREE.Vector3();
  const cameraDestination = new THREE.Vector3(15, 18, 19);
  const lookDestination = new THREE.Vector3();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let conversation: AgentId | null = null;
  let cameraView = 9;
  let zoom = 1;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: string, roughness = 0.8) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness }));
    return materials.get(color)!;
  }
  function box(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, color: string) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function cylinder(parent: THREE.Object3D, x: number, y: number, z: number, r: number, h: number, color: string, vertices = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, vertices), material(color));
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function textSprite(text: string, background = "#172c2e", foreground = "#f6f0df", scale = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 768; canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = background; ctx.beginPath(); ctx.roundRect(8, 10, 752, 108, 30); ctx.fill();
    ctx.fillStyle = foreground; ctx.font = "500 38px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 384, 64, 710);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.scale.set(3.7 * scale, 0.62 * scale, 1); sprite.renderOrder = 5;
    return sprite;
  }
  scene.add(new THREE.HemisphereLight("#fff6de", "#8a9a86", 2.7));
  const sun = new THREE.DirectionalLight("#fff1cc", 4.2);
  sun.position.set(-7, 15, -6); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
  sun.shadow.normalBias = 0.035; sun.shadow.bias = -0.0001; scene.add(sun);
  box(scene, 0, -0.35, 0, 14.6, 0.7, 11.6, "#c0b09a");
  const floor = box(scene, 0, 0, 0, 14, 0.12, 11, "#e7d8bd");
  floor.userData.floor = true;
  for (let x = -7; x < 7; x += 0.65) box(scene, x, 0.065, 0, 0.014, 0.006, 11, "#d3c4a9");
  for (let z = -5; z < 6; z += 2.2) for (let x = -6.7; x < 7; x += 1.3) box(scene, x, 0.068, z + ((Math.round(x * 10) % 2) ? 0.4 : 0), 0.64, 0.005, 0.012, "#d3c4a9");
  // Open front and right walls keep the entire playable floor visible.
  box(scene, 0, 1.6, -5.55, 14.4, 3.2, 0.18, "#eee9db");
  box(scene, -7.1, 1.6, 0, 0.18, 3.2, 11.2, "#eee9db");
  box(scene, 0, 0.2, 5.55, 14.4, 0.4, 0.18, "#f8f2e4");
  box(scene, 7.1, 0.2, 0, 0.18, 0.4, 11.2, "#f8f2e4");
  box(scene, 0, 3.18, -5.5, 14.3, 0.1, 0.3, "#b7b39c");
  for (const z of [-3.3, 0.2, 3.3]) {
    box(scene, -7, 1.9, z, 0.08, 1.9, 2.3, "#b8d4cd");
    box(scene, -6.92, 1.9, z, 0.1, 2.05, 0.065, "#f9f5e9");
    box(scene, -6.92, 1.9, z - 1.15, 0.1, 2.05, 0.065, "#f9f5e9");
    box(scene, -6.92, 1.9, z + 1.15, 0.1, 2.05, 0.065, "#f9f5e9");
    box(scene, -6.9, 1.05, z, 0.3, 0.1, 2.5, "#f9f5e9");
  }
  const wallTitle = textSprite("FIELDWORK  /  DESIGN STUDIO", "#eee9db", "#314a42", 1.25);
  wallTitle.position.set(-2, 2.55, -5.3); scene.add(wallTitle);
  function stationGroup(id: StationId) { const group = new THREE.Group(); group.userData.interaction = id; scene.add(group); return group; }
  function desk(parent: THREE.Object3D, x: number, z: number, width: number) {
    box(parent, x, 0.92, z, width, 0.12, 1.05, "#b17b51");
    for (const dx of [-width / 2 + 0.12, width / 2 - 0.12]) for (const dz of [-0.4, 0.4]) box(parent, x + dx, 0.47, z + dz, 0.07, 0.9, 0.07, "#344d48");
  }
  function chair(x: number, z: number, color = "#537c69") {
    cylinder(scene, x, 0.48, z, 0.32, 0.12, color);
    box(scene, x, 0.83, z + 0.23, 0.58, 0.65, 0.1, color);
    cylinder(scene, x, 0.24, z, 0.055, 0.4, "#344d48");
    box(scene, x, 0.08, z, 0.6, 0.05, 0.06, "#344d48");
    box(scene, x, 0.08, z, 0.06, 0.05, 0.6, "#344d48");
  }
  const briefTable = stationGroup("brief"); desk(briefTable, -5.3, -3.5, 2.3);
  for (let i = 0; i < 3; i++) { const sheet = box(briefTable, -5.6 + i * 0.24, 1.0 + i * 0.012, -3.45, 0.5, 0.012, 0.65, "#fff7dc"); sheet.rotation.y = i * 0.2; }
  cylinder(briefTable, -4.6, 1.12, -3.6, 0.09, 0.26, "#cf7454");
  const workstation = stationGroup("desk"); desk(workstation, -1.5, -3.7, 2.4);
  box(workstation, -1.5, 1.05, -3.9, 0.55, 0.05, 0.35, "#344d48");
  box(workstation, -1.5, 1.27, -3.95, 0.07, 0.5, 0.07, "#344d48");
  box(workstation, -1.5, 1.61, -3.98, 1.35, 0.85, 0.08, "#253b3a");
  box(workstation, -1.5, 1.61, -3.925, 1.24, 0.73, 0.014, "#c0d0b3");
  box(workstation, -1.6, 1.01, -3.38, 0.8, 0.05, 0.28, "#e2ddcf");
  box(workstation, -0.9, 1.01, -3.35, 0.13, 0.045, 0.21, "#e2ddcf");
  cylinder(workstation, -2.4, 1.08, -3.8, 0.1, 0.21, "#e3a044");
  chair(-1.5, -2.8);
  // Shared desk: gives Alex somewhere visible to work between jobs.
  desk(scene, 2.2, -2.3, 1.4); box(scene, 2.2, 1.1, -2.3, 0.65, 0.08, 0.5, "#3d5d56"); chair(2.2, -1.4, "#cf8c62");
  const review = stationGroup("board");
  box(review, 3.0, 1.8, -5.36, 3.1, 1.8, 0.12, "#ab926d");
  for (let i = 0; i < 4; i++) box(review, 2 + (i % 2) * 1.6, 1.8 + Math.floor(i / 2) * 0.5, -5.27, 0.28, 0.3, 0.01, ["#e7bd61", "#c1cdaf"][i % 2]);
  const posterCanvas = document.createElement("canvas"); posterCanvas.width = 420; posterCanvas.height = 560;
  const posterTexture = new THREE.CanvasTexture(posterCanvas); posterTexture.colorSpace = THREE.SRGBColorSpace;
  const posterMaterial = new THREE.MeshStandardMaterial({ map: posterTexture, roughness: 1, side: THREE.DoubleSide });
  const proofCanvas = document.createElement("canvas"); proofCanvas.width = 420; proofCanvas.height = 560;
  const proofTexture = new THREE.CanvasTexture(proofCanvas); proofTexture.colorSpace = THREE.SRGBColorSpace;
  const proofMaterial = new THREE.MeshStandardMaterial({ map: proofTexture, roughness: 1, side: THREE.DoubleSide });
  let carryingProof = false;
  const wallPoster = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 1.28), posterMaterial);
  wallPoster.position.set(3, 1.8, -5.25); wallPoster.visible = false; review.add(wallPoster);
  const printer = stationGroup("printer");
  box(printer, 5.8, 0.55, 1, 0.8, 1.0, 1.8, "#aebcaf");
  box(printer, 5.8, 1.15, 1, 0.9, 0.45, 1.7, "#e9e8db");
  box(printer, 5.31, 1.2, 1, 0.06, 0.13, 1.1, "#263e38");
  const printerLight = box(printer, 5.29, 1.38, 0.5, 0.03, 0.1, 0.2, "#c1d78f");
  const serviceDoor = new THREE.Group(); serviceDoor.position.set(5.32, 0.67, 0.45); printer.add(serviceDoor);
  box(serviceDoor, 0, 0, 0.42, 0.04, 0.5, 0.8, "#7b8e82");
  box(serviceDoor, -0.035, 0.1, 0.72, 0.06, 0.05, 0.14, "#283e37");
  let printerDoorTarget = 0;
  let pressure = 0;
  box(printer, 5.17, 0.98, 1, 0.4, 0.04, 1.2, "#344d48");
  const printedSheet = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), proofMaterial);
  printedSheet.rotation.x = -Math.PI / 2; printedSheet.position.set(5.08, 1.01, 1); printedSheet.visible = false; printer.add(printedSheet);
  const lounge = stationGroup("delivery");
  box(lounge, 1.5, 0.47, 4.3, 1.7, 0.6, 0.8, "#c38658");
  box(lounge, 1.5, 0.95, 4.66, 1.8, 0.65, 0.17, "#c38658");
  for (const x of [0.6, 2.4]) box(lounge, x, 0.75, 4.3, 0.17, 0.6, 0.9, "#c38658");
  cylinder(lounge, -0.1, 0.5, 4.2, 0.4, 0.09, "#c2a07b"); cylinder(lounge, -0.1, 0.25, 4.2, 0.1, 0.5, "#344d48");
  const deliveredSheet = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), proofMaterial);
  deliveredSheet.rotation.x = -Math.PI / 2; deliveredSheet.position.set(-0.1, 0.56, 4.2); deliveredSheet.visible = false; lounge.add(deliveredSheet);
  const coffee = stationGroup("coffee");
  box(coffee, -5.7, 0.5, 3.7, 1.7, 1, 0.9, "#6e8b70");
  box(coffee, -5.7, 1.04, 3.7, 1.8, 0.1, 1, "#e4d7bd");
  box(coffee, -5.5, 1.32, 3.7, 0.45, 0.5, 0.4, "#263e38");
  cylinder(coffee, -6.15, 1.18, 3.7, 0.08, 0.19, "#f7f0dd");
  function plant(x: number, z: number, height = 1) {
    cylinder(scene, x, 0.27, z, 0.26, 0.45, "#c37d58");
    cylinder(scene, x, height / 2 + 0.35, z, 0.04, height, "#68794c");
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.33, 7, 5), material(i % 2 ? "#779469" : "#476b4c"));
      leaf.scale.set(0.8, 1.4, 0.65); const angle = i * 2.4;
      leaf.position.set(x + Math.sin(angle) * 0.23, 0.6 + i * height / 8, z + Math.cos(angle) * 0.23); leaf.rotation.z = Math.sin(angle) * 0.6; leaf.castShadow = true; scene.add(leaf);
    }
  }
  plant(-6.3, -4.7, 1.3); plant(6, -4.5, 1.8); plant(5.8, 4.6, 1.4); plant(-6.4, 0.8, 0.8);
  // Bookshelf, sample boards, rug, lamps and physical clutter.
  box(scene, 5.7, 1.1, -5.15, 1.7, 2.2, 0.5, "#a27853");
  for (let row = 0; row < 3; row++) {
    box(scene, 5.7, 0.35 + row * 0.7, -4.86, 1.65, 0.06, 0.6, "#c3a37d");
    for (let i = 0; i < 7; i++) box(scene, 5.05 + i * 0.18, 0.61 + row * 0.7, -4.9, 0.12, 0.43 + i % 2 * 0.08, 0.35, ["#668176", "#d29b62", "#e1cbaa", "#7a8799"][i % 4]);
  }
  box(scene, 0.8, 0.07, 3.8, 3.7, 0.018, 2.3, "#9eae91");
  for (const x of [-3.3, 1]) {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.35, 16, 1, true), material("#e6d0a7"));
    shade.position.set(x, 3.7, -1); shade.rotation.x = Math.PI; scene.add(shade);
    cylinder(scene, x, 4.2, -1, 0.015, 0.8, "#52645b");
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 48), new THREE.MeshBasicMaterial({ color: "#d5a357", side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.085; scene.add(ring);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.2, 24), new THREE.MeshBasicMaterial({ color: "#fbf7df", side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.08; marker.visible = false; scene.add(marker);
  function person(id: string, color: string, skin: string, x: number, z: number) {
    const group = new THREE.Group(); group.position.set(x, 0.08, z); group.userData.interaction = id;
    cylinder(group, 0, 0.92, 0, 0.21, 0.55, color, 8);
    box(group, 0, 0.62, 0, 0.34, 0.15, 0.25, "#334947");
    const headRig = new THREE.Group(); group.add(headRig);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), material(skin)); head.position.y = 1.46; head.scale.y = 1.1; headRig.add(head); head.castShadow = true;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.207, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), material(id === "alex" ? "#5b382c" : "#2e2d29")); hair.position.y = 1.51; headRig.add(hair);
    const eyes: THREE.Mesh[] = [];
    const brows: THREE.Mesh[] = [];
    for (const x of [-0.075, 0.075]) {
      box(headRig, x, 1.47, 0.178, 0.057, 0.037, 0.024, "#f5ebdc");
      eyes.push(box(headRig, x, 1.47, 0.194, 0.026, 0.03, 0.017, "#232b28"));
      const brow = box(headRig, x, 1.525, 0.178, 0.062, 0.012, 0.023, "#493e34");
      brow.rotation.z = x > 0 ? -0.1 : 0.1; brows.push(brow);
    }
    box(headRig, 0, 1.424, 0.196, 0.043, 0.048, 0.04, skin);
    const mouth = box(headRig, 0, 1.372, 0.18, 0.075, 0.014, 0.02, "#754a3e");
    cylinder(headRig, -0.2, 1.45, 0, 0.045, 0.09, skin, 8);
    cylinder(headRig, 0.2, 1.45, 0, 0.045, 0.09, skin, 8);
    box(group, 0, 1.2, 0.14, 0.12, 0.08, 0.025, "#f6e9d0");
    if (id === "maya") {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), material("#2e2d29"));
      bun.position.set(0, 1.68, -0.13); headRig.add(bun);
    }
    const limbs: THREE.Group[] = [];
    for (let i = 0; i < 4; i++) {
      const limb = new THREE.Group(); const arm = i < 2; const sign = i % 2 ? 1 : -1;
      limb.position.set(sign * (arm ? 0.28 : 0.11), arm ? 1.13 : 0.63, 0);
      box(limb, 0, arm ? -0.19 : -0.25, 0, arm ? 0.13 : 0.14, arm ? 0.42 : 0.5, 0.15, arm ? color : "#344a47");
      if (arm) cylinder(limb, 0, -0.43, 0, 0.068, 0.14, skin, 8);
      else box(limb, 0, -0.51, 0.05, 0.17, 0.1, 0.28, "#f3e9d2");
      group.add(limb); limbs.push(limb);
    }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), new THREE.MeshBasicMaterial({ color: "#263e38", transparent: true, opacity: 0.14, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015; group.add(shadow);
    scene.add(group); return { group, limbs, headRig, mouth, eyes, brows, mood: "welcoming" as Mood, speaking: false, path: [] as Point[], bubble: null as THREE.Sprite | null, bubbleUntil: 0, step: 0 };
  }
  const player = person("player", "#e6c76f", "#c59370", -0.5, 1.7);
  const yourLabel = textSprite("YOU", "#f3d57d", "#263e38", 0.38); yourLabel.position.y = 1.95; player.group.add(yourLabel);
  const carried = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.6), posterMaterial); carried.position.set(0.33, 0.9, 0.25); carried.rotation.y = -0.2; carried.visible = false; player.group.add(carried);
  const npcs = Object.fromEntries(agentIds.map((id, i) => {
    const p = stations[characters[id].home];
    const npc = person(id, characters[id].color, ["#bc896a", "#dfb397", "#90654b"][i], p.x, p.z);
    const label = textSprite(characters[id].name, "#f6f0df", "#344b44", 0.48); label.position.y = 2; npc.group.add(label);
    return [id, npc];
  })) as Record<AgentId, ReturnType<typeof person>>;
  let targetInteraction: StationId | AgentId | null = null;
  let objective: StationId = "brief";
  let destroyed = false, paused = false, inputLocked = false, frame = 0, last = performance.now(), reported = 0;
  const keys = new Set<string>();
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  function walkTo(p: Point, interaction: typeof targetInteraction = null) {
    player.path = findPath(player.group.position, p); targetInteraction = interaction;
    marker.position.set(p.x, 0.08, p.z); marker.visible = true;
    renderer.domElement.focus({ preventScroll: true });
  }
  function targetPoint(id: StationId | AgentId) { return id in stations ? stations[id as StationId] : npcs[id as AgentId].group.position; }
  function approach(id: StationId | AgentId) { const p = targetPoint(id); walkTo({ x: p.x, z: p.z }, id); }
  function click(event: PointerEvent) {
    if (paused || inputLocked) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(scene.children, true).find(h => !(h.object instanceof THREE.Sprite) && h.object.visible);
    if (!hit) return;
    let obj: THREE.Object3D | null = hit.object;
    while (obj && !obj.userData.interaction) obj = obj.parent;
    const id = obj?.userData.interaction as StationId | AgentId | "player" | undefined;
    if (id && id !== "player") approach(id);
    else if (hit.object.userData.floor && canWalk(hit.point)) walkTo(hit.point);
  }
  function keydown(e: KeyboardEvent) {
    if (paused || inputLocked || e.target !== renderer.domElement) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "e"].includes(k)) e.preventDefault();
    if (k === "e") {
      const candidates = [...Object.entries(stations), ...agentIds.map(id => [id, npcs[id].group.position] as const)].sort((a, b) => distance(player.group.position, a[1]) - distance(player.group.position, b[1]));
      if (candidates[0] && distance(player.group.position, candidates[0][1]) < 1.5) events.interact(candidates[0][0] as StationId | AgentId);
    } else keys.add(k);
  }
  const keyup = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  const blur = () => keys.clear();
  const wheel = (e: WheelEvent) => { e.preventDefault(); zoom = Math.max(0.65, Math.min(1.7, zoom - e.deltaY * 0.001)); resize(); };
  renderer.domElement.addEventListener("pointerdown", click);
  renderer.domElement.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup); window.addEventListener("blur", blur);
  renderer.domElement.addEventListener("blur", blur);
  renderer.domElement.addEventListener("wheel", wheel, { passive: false });
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height); const aspect = width / Math.max(height, 1);
    if (!conversation) cameraView = (aspect < 1 ? 12.5 / Math.max(aspect, 0.5) : 9) / zoom;
    camera.left = -cameraView * aspect; camera.right = cameraView * aspect;
    camera.top = cameraView; camera.bottom = -cameraView; camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  function move(who: typeof player, dt: number, speed: number) {
    const next = who.path[0];
    let walking = false;
    if (next) {
      const p = who.group.position; const d = distance(p, next);
      if (d < 0.09) who.path.shift();
      else {
        const stride = Math.min(speed * dt, d); const dx = (next.x - p.x) / d, dz = (next.z - p.z) / d;
        p.x += dx * stride; p.z += dz * stride; who.group.rotation.y = Math.atan2(dx, dz); walking = true;
      }
    }
    who.step += walking ? dt * 10 : dt;
    who.limbs.forEach((limb, i) => { limb.rotation.x = walking ? Math.sin(who.step + (i % 2 ? Math.PI : 0)) * 0.45 : Math.sin(who.step * 0.8) * 0.025; });
    return walking;
  }
  function animate(now: number) {
    if (destroyed) return;
    frame = requestAnimationFrame(animate); const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!paused) {
      if (!inputLocked) {
      let dx = 0, dz = 0;
      if (keys.has("w") || keys.has("arrowup")) { dx--; dz--; }
      if (keys.has("s") || keys.has("arrowdown")) { dx++; dz++; }
      if (keys.has("a") || keys.has("arrowleft")) { dx--; dz++; }
      if (keys.has("d") || keys.has("arrowright")) { dx++; dz--; }
      if (dx || dz) {
        player.path = []; targetInteraction = null; marker.visible = false;
        const len = Math.hypot(dx, dz); const p = player.group.position; const speed = 3.2 * dt;
        if (canWalk({ x: p.x + dx / len * speed, z: p.z })) p.x += dx / len * speed;
        if (canWalk({ x: p.x, z: p.z + dz / len * speed })) p.z += dz / len * speed;
        player.group.rotation.y = Math.atan2(dx, dz); player.step += dt * 10;
        player.limbs.forEach((limb, i) => { limb.rotation.x = Math.sin(player.step + (i % 2 ? Math.PI : 0)) * 0.45; });
      } else move(player, dt, 3.2);
      if (targetInteraction && player.path.length === 0 && distance(player.group.position, targetPoint(targetInteraction)) >= 0.75) {
        player.path = findPath(player.group.position, targetPoint(targetInteraction));
      }
      if (targetInteraction && distance(player.group.position, targetPoint(targetInteraction)) < 0.75) {
        const id = targetInteraction; targetInteraction = null; player.path = []; marker.visible = false; events.interact(id);
      }
      }
      for (const id of agentIds) {
        const npc = npcs[id];
        if (conversation !== id) move(npc, dt, 1.5);
        else {
          npc.group.rotation.y = Math.atan2(2.2, 4.2);
          const gesture = npc.speaking && !reducedMotion ? Math.sin(now * 0.004) : 0;
          npc.limbs[0].rotation.x = -0.2 + gesture * 0.18;
          npc.limbs[1].rotation.z = -0.12 - Math.abs(gesture) * 0.14;
          npc.headRig.rotation.z = gesture * (npc.mood === "urgent" ? 0.055 : 0.035);
          npc.headRig.rotation.x = npc.mood === "concerned" ? 0.05 : npc.mood === "relieved" ? -0.03 : 0;
          npc.brows.forEach((brow, i) => { brow.rotation.z = (i ? -1 : 1) * (["concerned", "urgent"].includes(npc.mood) ? -0.3 : 0.12); });
        }
        npc.mouth.scale.y = npc.speaking && !reducedMotion ? 1 + Math.abs(Math.sin(now * 0.018)) * 3 : 1;
        const blink = !reducedMotion && Math.sin(now * 0.0009 + agentIds.indexOf(id) * 2) > 0.996;
        npc.eyes.forEach(eye => { eye.scale.y = blink ? 0.1 : 1; });
        if (npc.bubble && now > npc.bubbleUntil) { npc.group.remove(npc.bubble); disposeSprite(npc.bubble); npc.bubble = null; }
      }
      ring.position.x = stations[objective].x; ring.position.z = stations[objective].z;
      const scale = 1 + Math.sin(now * 0.003) * 0.08; ring.scale.setScalar(scale);
    }
    if (now - reported > 150) { reported = now; events.position({ x: player.group.position.x, z: player.group.position.z }); }
    serviceDoor.rotation.y += (printerDoorTarget - serviceDoor.rotation.y) * Math.min(1, dt * 5);
    sun.intensity += (4.2 - pressure * 0.8 - sun.intensity) * dt;
    const { width, height } = host.getBoundingClientRect();
    const aspect = width / Math.max(height, 1);
    let targetView = (aspect < 1 ? 12.5 / Math.max(aspect, 0.5) : 9) / zoom;
    if (conversation) {
      const framing = conversationFraming(npcs[conversation].group.position, aspect);
      cameraDestination.set(framing.position.x, framing.position.y, framing.position.z);
      lookDestination.set(framing.lookAt.x, framing.lookAt.y, framing.lookAt.z);
      targetView = framing.view;
    } else {
      cameraDestination.set(15, 18, 19); lookDestination.set(0, 0, 0);
    }
    const blend = reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    camera.position.lerp(cameraDestination, blend); cameraLook.lerp(lookDestination, blend);
    camera.lookAt(cameraLook); cameraView += (targetView - cameraView) * blend;
    camera.left = -cameraView * aspect; camera.right = cameraView * aspect;
    camera.top = cameraView; camera.bottom = -cameraView; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(animate); events.ready();
  renderer.domElement.focus({ preventScroll: true });
  function disposeSprite(sprite: THREE.Sprite) { sprite.material.map?.dispose(); sprite.material.dispose(); }
  return {
    approach,
    conversation(id: AgentId | null) {
      conversation = id;
      player.group.visible = !id; ring.visible = !id;
      for (const other of agentIds) {
        const npc = npcs[other];
        npc.group.children.filter(child => child instanceof THREE.Sprite).forEach(child => { child.visible = !id; });
        npc.headRig.rotation.z = 0; npc.limbs[1].rotation.z = 0;
        if (!id) npc.speaking = false;
      }
    },
    setMood(id: AgentId, mood: Mood) { npcs[id].mood = mood; },
    setPressure(value: number) { pressure = value; },
    setPrinterState(state: "unknown" | "jammed" | "cleared", closePanel = false) {
      printerLight.material.color.set(state === "jammed" ? "#efaa45" : "#c1d78f");
      printerDoorTarget = state === "cleared" && !closePanel ? -0.85 : 0;
    },
    setSpeaking(id: AgentId, value: boolean) { npcs[id].speaking = value; },
    setPaused(value: boolean) { paused = value; keys.clear(); },
    lockInput(value: boolean) { inputLocked = value; keys.clear(); if (value) { player.path = []; targetInteraction = null; marker.visible = false; } },
    setObjective(id: StationId) { objective = id; },
    setCarry(kind: "brief" | "design" | "proof" | null) { carryingProof = kind === "proof"; carried.visible = kind !== null; carried.material = carryingProof ? proofMaterial : posterMaterial; },
    agentPosition(id: AgentId): Point { const p = npcs[id].group.position; return { x: p.x, z: p.z }; },
    moveAgent(id: AgentId, station: StationId) { npcs[id].path = findPath(npcs[id].group.position, stations[station]); },
    speak(id: AgentId, text: string) {
      const npc = npcs[id]; if (npc.bubble) { npc.group.remove(npc.bubble); disposeSprite(npc.bubble); }
      const short = text.length > 72 ? `${text.slice(0, 69)}…` : text;
      npc.bubble = textSprite(short, "#fff8e8", "#263e38", 1.3); npc.bubble.position.y = 2.65; npc.bubble.visible = !conversation;
      npc.bubbleUntil = performance.now() + 9000; npc.group.add(npc.bubble);
    },
    updatePoster(layout: LayoutItem[], palette: string, phase: string, venue = "CENTRAL LIBRARY", proof?: { layout: LayoutItem[]; palette: string; venue: string } | null) {
      function draw(canvas: HTMLCanvasElement, layout: LayoutItem[], palette: string, venue: string) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = palette; ctx.fillRect(0, 0, 420, 560);
      ctx.fillStyle = "#e7d3a4"; ctx.beginPath(); ctx.arc(330, 230, 130, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#263e38"; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(330, 230, 70, 0.5, 5.5); ctx.stroke();
      ctx.fillStyle = "#223a35";
      const lines = { title: ["REPAIR", "CAFÉ."], details: ["SATURDAY · 10–2", venue, "Bring one broken household item"], booking: ["BOOK A FREE SLOT →", "library.example/repair"] };
      for (const item of layout) {
        ctx.font = `${item.id === "title" ? 800 : 600} ${item.size * 1.4}px system-ui`;
        lines[item.id].forEach((line, i) => ctx.fillText(line, item.x / 100 * 420, item.y / 100 * 560 + i * item.size * 1.65, 390 - item.x / 100 * 420));
      }
      }
      draw(posterCanvas, layout, palette, venue); posterTexture.needsUpdate = true;
      if (proof) { draw(proofCanvas, proof.layout, proof.palette, proof.venue); proofTexture.needsUpdate = true; }
      wallPoster.visible = ["print", "deliver", "complete"].includes(phase);
      printedSheet.visible = phase === "deliver" && !carryingProof;
      deliveredSheet.visible = phase === "complete";
    },
    dispose() {
      destroyed = true; cancelAnimationFrame(frame); observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", click); renderer.domElement.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup); window.removeEventListener("blur", blur); renderer.domElement.removeEventListener("blur", blur); renderer.domElement.removeEventListener("wheel", wheel);
      const geometries = new Set<THREE.BufferGeometry>(); const allMaterials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>();
      scene.traverse(o => {
        if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) allMaterials.add(m); }
        if (o instanceof THREE.Sprite) allMaterials.add(o.material);
      });
      for (const m of allMaterials) { if ("map" in m && m.map instanceof THREE.Texture) textures.add(m.map); m.dispose(); }
      geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
