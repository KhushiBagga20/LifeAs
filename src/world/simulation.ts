import { StoryState } from "./story";
import { z } from "zod";

export type Point = { x: number; z: number };
export const stations = {
  brief: { x: -5.3, z: -2.4, label: "Project table", verb: "Pick up the client brief" },
  desk: { x: -1.5, z: -2.6, label: "Your workstation", verb: "Design the poster" },
  board: { x: 3.0, z: -3.9, label: "Review wall", verb: "Pin your design for review" },
  printer: { x: 5.1, z: 1.0, label: "Print station", verb: "Print a proof" },
  delivery: { x: 0.2, z: 3.8, label: "Client lounge", verb: "Deliver the printed poster" },
  coffee: { x: -5.5, z: 2.2, label: "Kitchenette", verb: "Take a coffee break" },
} satisfies Record<string, Point & { label: string; verb: string }>;
export type StationId = keyof typeof stations;
export const stationIds = Object.keys(stations) as StationId[];
export const agentIds = ["maya", "alex", "sam"] as const;
export type AgentId = typeof agentIds[number];
export const characters = {
  maya: { name: "Maya", role: "Creative director", color: "#d47b53", home: "board" as StationId, goal: "Get a legible, distinctive poster approved. Review the player's work at the review wall. Ask about their design choices. You are observant, direct, kind, and dislike vague feedback." },
  alex: { name: "Alex", role: "Production designer", color: "#729c8b", home: "printer" as StationId, goal: "Make the print handoff reliable. Inspect the printer, then help colleagues at their desks. Remind them to review the layout before printing. You are practical, dryly funny, and precise." },
  sam: { name: "Sam", role: "Library organiser", color: "#798fb8", home: "delivery" as StationId, goal: "Leave with a usable repair café poster. Explain the audience and booking action. Wait in the lounge or discuss the brief at the project table. You are enthusiastic and tend to add ideas late." },
};
export type LayoutItem = { id: "title" | "details" | "booking"; x: number; y: number; size: number };
export const initialLayout: LayoutItem[] = [
  { id: "title", x: 8, y: 14, size: 34 },
  { id: "details", x: 8, y: 58, size: 15 },
  { id: "booking", x: 8, y: 82, size: 12 },
];
export const WorldSnapshot = z.object({
  phase: z.enum(["arrive", "design", "review", "print", "deliver", "complete"]),
  layout: z.array(z.object({ id: z.enum(["title", "details", "booking"]), x: z.number().min(0).max(80), y: z.number().min(0).max(90), size: z.number().min(10).max(44) })).max(3),
  activity: z.array(z.string().max(180)).max(8),
  story: StoryState.optional(),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshot>;
export type Phase = WorldSnapshot["phase"];
export const phaseGoals: Record<Phase, { title: string; detail: string; station: StationId }> = {
  arrive: { title: "Find your first brief", detail: "Walk to the project table and collect the library’s brief.", station: "brief" },
  design: { title: "Make something", detail: "Use your workstation. Arrange the type on a repair café poster.", station: "desk" },
  review: { title: "Put your work out there", detail: "Carry your design to the review wall. Pin it up for feedback.", station: "board" },
  print: { title: "From screen to paper", detail: "Walk to the printer and run a proof of your reviewed design.", station: "printer" },
  deliver: { title: "Make the handoff", detail: "Pick up the print and bring it to Sam in the client lounge.", station: "delivery" },
  complete: { title: "That’s a wrap", detail: "Your poster is delivered. Explore, talk to the team, or start a new day.", station: "delivery" },
};
export function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.z - b.z); }
// Shared by walking, collision and tests. Furniture footprints include space for the player.
export const obstacles = [
  { x: -5.3, z: -3.5, w: 2.3, d: 1.05 },
  { x: -1.5, z: -3.7, w: 2.4, d: 1.05 },
  { x: 5.8, z: 1.0, w: 0.8, d: 1.8 },
  { x: -5.7, z: 3.7, w: 1.7, d: 0.9 },
  { x: 1.5, z: 4.3, w: 1.7, d: 0.8 },
];
export function canWalk(p: Point) {
  return Math.abs(p.x) < 6.7 && Math.abs(p.z) < 5 && !obstacles.some(o => Math.abs(p.x - o.x) < o.w / 2 + 0.22 && Math.abs(p.z - o.z) < o.d / 2 + 0.22);
}
// Grid A* keeps click-to-walk and NPC routes out of desks and tables.
export function findPath(from: Point, to: Point): Point[] {
  const step = 0.4;
  const key = (x: number, z: number) => `${x},${z}`;
  const start = { x: Math.round(from.x / step), z: Math.round(from.z / step) };
  const goal = { x: Math.round(to.x / step), z: Math.round(to.z / step) };
  const open = [{ ...start, f: 0 }];
  const costs = new Map([[key(start.x, start.z), 0]]);
  const parent = new Map<string, string>();
  let end: string | null = null;
  for (let tries = 0; open.length && tries < 2500; tries++) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    const k = key(current.x, current.z);
    if (Math.abs(current.x - goal.x) + Math.abs(current.z - goal.z) <= 1) { end = k; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx, z = current.z + dz;
      const nk = key(x, z);
      if (!canWalk({ x: x * step, z: z * step })) continue;
      const g = costs.get(k)! + 1;
      if (g >= (costs.get(nk) ?? Infinity)) continue;
      costs.set(nk, g); parent.set(nk, k);
      open.push({ x, z, f: g + Math.abs(x - goal.x) + Math.abs(z - goal.z) });
    }
  }
  if (!end) return [];
  const result: Point[] = [];
  while (end !== key(start.x, start.z)) {
    const [x, z] = end.split(",").map(Number);
    result.unshift({ x: x * step, z: z * step });
    end = parent.get(end)!;
  }
  return result;
}
export function layoutIssues(layout: LayoutItem[]) {
  const title = layout.find(i => i.id === "title");
  const details = layout.find(i => i.id === "details");
  const booking = layout.find(i => i.id === "booking");
  const feedback: string[] = [];
  if (!title || !details || !booking) return ["The poster needs a headline, event details, and a booking action."];
  if (title.size < details.size + 5) feedback.push("Give the headline a stronger size hierarchy so I know where to look first.");
  if (booking.size < 14) feedback.push("The booking line will be small in print. Try at least 14 pt.");
  if (title.y > details.y || details.y > booking.y) feedback.push("Try a reading order: event first, practical details next, then the booking action.");
  for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
    if (Math.abs(layout[i].y - layout[j].y) < 12 && Math.abs(layout[i].x - layout[j].x) < 60) feedback.push("Two text blocks overlap. Leave breathing room between them.");
  }
  return [...new Set(feedback)];
}

export function reviewLayout(layout: LayoutItem[]) {
  const issues = layoutIssues(layout);
  return issues.length ? issues : ["The hierarchy is clear and the booking line reads well. Let’s see it on paper."];
}
