import { z } from "zod";
import type { AgentId, Phase } from "./simulation";

export const StoryState = z.object({
  minutes: z.number().int().min(0).max(1440),
  deadline: z.number().int().min(0).max(1440),
  request: z.enum(["unheard", "pending", "confirmed", "online", "declined"]),
  jam: z.enum(["unknown", "jammed", "cleared"]),
  drafts: z.number().int().min(0).max(100),
  reviews: z.number().int().min(0).max(100),
  extension: z.boolean(),
  printedVenue: z.string().max(120).nullable(),
  draftVenue: z.string().max(120).default("LIBRARY FOYER"),
  delivered: z.boolean(),
  printIssues: z.array(z.string().max(240)).max(8).default([]),
});
export type StoryState = z.infer<typeof StoryState>;
export type StoryAction = "brief" | "draft" | "review" | "confirm-room" | "online-room" | "decline-change" | "extension" | "inspect-printer" | "clear-jam" | "print" | "deliver";
export type Mood = "welcoming" | "focused" | "concerned" | "urgent" | "relieved";
export const freshStory = (): StoryState => ({ minutes: 540, deadline: 600, request: "unheard", jam: "unknown", drafts: 0, reviews: 0, extension: false, printedVenue: null, draftVenue: "LIBRARY FOYER", delivered: false, printIssues: [] });
export const clockTime = (minutes: number) => `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
export function venueForStory(story: StoryState) {
  if (story.request === "confirmed") return "EAST HALL · CENTRAL LIBRARY";
  if (story.request === "online") return "CENTRAL LIBRARY · ROOM DETAILS ONLINE";
  return "LIBRARY FOYER";
}
export function advanceStory(previous: StoryState, action: StoryAction): StoryState {
  const story = { ...previous };
  const spend = (n: number) => { story.minutes = Math.min(1439, story.minutes + n); };
  switch (action) {
    case "brief": if (story.minutes === 540) spend(5); break;
    case "draft": spend(story.drafts ? 7 : 14); story.drafts++; story.draftVenue = venueForStory(story); story.printedVenue = null; break;
    case "review": spend(story.reviews ? 4 : 6); story.reviews++; if (story.request === "unheard") story.request = "pending"; break;
    case "confirm-room": if (story.request === "pending" || story.request === "declined") { spend(12); story.request = "confirmed"; } break;
    case "online-room": if (story.request === "pending" || story.request === "declined") { spend(5); story.request = "online"; } break;
    case "decline-change": if (story.request === "pending") { spend(1); story.request = "declined"; } break;
    case "extension": if (!story.extension) { spend(2); story.deadline += 15; story.extension = true; } break;
    case "inspect-printer": if (story.jam === "unknown") { spend(2); story.jam = "jammed"; } break;
    case "clear-jam": if (story.jam === "jammed") { spend(5); story.jam = "cleared"; } break;
    case "print": if (story.jam === "cleared") { spend(6); story.printedVenue = story.draftVenue; } break;
    case "deliver": if (story.printedVenue && !story.delivered) { spend(5); story.delivered = true; } break;
  }
  return story;
}
export function handoffOutcome(story: StoryState) {
  const stale = story.printedVenue !== venueForStory(story) || !["confirmed", "online"].includes(story.request);
  if (stale) return { title: "A beautiful poster. The wrong room.", spoken: "The foyer’s closed. If we put this up, people will wait outside a room we can’t use. We need to correct this before it goes out.", line: "Sam goes quiet. ‘The foyer’s closed. If we put this up, people will wait outside a room we can’t use.’ The print needs correcting before it can go out.", accepted: false };
  if (story.printIssues?.length) return { title: "The proof needs another pass.", spoken: `I can see what you’re going for, but this still needs a correction before it goes on the wall. ${story.printIssues[0]} Can we fix it and run another proof?`, line: `Sam holds the proof at arm’s length. The artwork still has a layout issue: ${story.printIssues[0]}`, accepted: false };
  if (story.minutes > story.deadline) return { title: "Good work. A missed departure.", spoken: "This works. But the volunteer’s already left. I’ll have to distribute them tomorrow. Next time, tell me we’re running late while there’s still something I can do.", line: "Sam checks the proof, then the time. ‘This works. But the volunteer who was taking these round has already left. I’ll distribute them tomorrow.’ You protected the information; the schedule slipped.", accepted: true };
  const locationCheck = story.request === "online" ? "Central Library. Room details online." : "East Hall.";
  return { title: "Something real leaves the studio.", spoken: story.extension ? `${locationCheck} Right date. Clear booking. We made it. I’m glad you told me you needed the extra time.` : `${locationCheck} Right date. Clear booking. People are going to find us. Thank you for seeing this through.`, line: story.extension ? `Sam runs a thumb along the proof. ‘${locationCheck} Right date. Clear booking.’ They tuck it into a folder. The extra fifteen minutes mattered. So did asking for them before it was too late.` : "Sam checks the proof twice, then smiles. ‘People are going to find us.’ Alex’s printer falls quiet. For the first time today, nobody asks you to change anything.", accepted: true };
}
export function moodFor(agent: AgentId, story: StoryState): Mood {
  if (story.delivered) return !handoffOutcome(story).accepted ? "concerned" : story.minutes > story.deadline ? "focused" : "relieved";
  if (story.deadline - story.minutes <= 12) return "urgent";
  if (agent === "sam" && ["pending", "declined"].includes(story.request)) return "concerned";
  if (agent === "alex" && story.jam === "jammed") return "concerned";
  return story.drafts ? "focused" : "welcoming";
}
export const roomCrisis = "The foyer’s closed. A leak overnight. Facilities mentioned East Hall, but nobody’s confirmed it. Our volunteer leaves with the posters at ten. Can we still make this work?";
export const storyResponses: Partial<Record<StoryAction, { agent: AgentId; line: string }>> = {
  "confirm-room": { agent: "sam", line: "East Hall is confirmed. Thank you for checking—I was about to send everyone to the wrong door. The brief is corrected. You’ll need to update the poster at your desk. We still need to get this downstairs before the volunteer leaves." },
  "online-room": { agent: "sam", line: "That could work. Keep Central Library on the poster; I’ll put the exact room on the booking page. People will have to check online, but at least we won’t send them to a closed door." },
  "decline-change": { agent: "sam", line: "I understand you’ve already laid it out. But the foyer is closed. Printing the approved version won’t make the room available. Please think about what happens when someone follows this poster." },
  extension: { agent: "sam", line: "They can wait until quarter past. After that they’re doing school pickup. We’ve got fifteen more minutes. That’s the last extension they can give us." },
};
export function storyGreeting(agent: AgentId, phase: Phase, story: StoryState): string | null {
  if (agent === "sam" && story.request === "pending") return roomCrisis;
  if (agent === "alex" && story.jam === "jammed") return "Don’t pull the sheet from the output slot. It’s caught in the rear path. Open the service panel, clear it gently, then we’ll run one proof. Not the whole batch.";
  if (story.deadline - story.minutes <= 12 && !story.delivered) return agent === "maya" ? "We don’t have time to make everything perfect. What’s the one thing that would make this unusable if we left it?" : agent === "sam" ? "How close are we? The volunteer’s waiting downstairs. If you need more time, tell me now, not when they’ve gone." : "One proof. Check it. Then we go.";
  if (story.delivered && agent === "sam") return handoffOutcome(story).spoken;
  if (phase === "review" && agent === "maya") return "Pin it up. We’ll look at the work before we defend it.";
  return null;
}
export type StoryChoice = { id: StoryAction | "finish" | "repair" | "restart"; label: string; detail: string };
export function storyChoices(agent: AgentId, story: StoryState): StoryChoice[] {
  if (agent !== "sam") return [];
  if (story.delivered) return [
    handoffOutcome(story).accepted ? { id: "finish", label: "Take a breath. The handoff is done.", detail: "Stay in the studio" } : { id: "repair", label: story.printIssues?.length ? "You’re right. I need to correct the layout." : "You’re right. I need to correct the venue.", detail: "Return to the design and make it right" },
    { id: "restart", label: "Play the day again.", detail: "A fresh brief, a fresh clock" },
  ];
  const choices: StoryChoice[] = [];
  if (["pending", "declined"].includes(story.request)) choices.push(
    { id: "confirm-room", label: "Let’s confirm East Hall before we print.", detail: "+12 min · verify the room and update the poster" },
    { id: "online-room", label: "Put the exact room on the booking page.", detail: "+5 min · keep the print useful while details change" },
    ...(story.request === "pending" ? [{ id: "decline-change" as const, label: "We should keep the already approved version.", detail: "+1 min · the foyer will remain on the poster" }] : []),
  );
  if (story.drafts && !["pending", "unheard"].includes(story.request) && !story.extension && !story.delivered) choices.push({ id: "extension", label: "Can the volunteer give us fifteen more minutes?", detail: "+2 min · ask for a later handoff" });
  return choices;
}

export function sceneDirection(agent: AgentId, story: StoryState): string {
  if (agent === "sam" && story.delivered) return "Sam checks the proof, then the clock. A long second passes.";
  if (agent === "sam" && story.request === "pending") return "A phone vibrates. Sam reads the message twice.";
  if (agent === "alex" && story.jam === "jammed") return "Alex cuts the feed. The printer falls silent.";
  if (story.deadline - story.minutes <= 12) return "Another glance at the clock. The room feels quieter now.";
  if (agent === "sam" && story.request === "confirmed") return "Sam ends the call and lets out a breath.";
  return agent === "maya" ? "Maya sets the work aside and gives you their full attention." : agent === "alex" ? "Alex wipes a trace of ink from their thumb." : "Sam holds a worn folder against their chest.";
}
