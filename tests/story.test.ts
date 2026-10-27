import { describe, expect, it } from "vitest";
import { advanceStory, clockTime, freshStory, handoffOutcome, moodFor, storyChoices, venueForStory, type StoryAction } from "@/world/story";
const play = (...actions: StoryAction[]) => actions.reduce(advanceStory, freshStory());
const opening: StoryAction[] = ["brief", "draft", "review"];
const production: StoryAction[] = ["inspect-printer", "clear-jam", "print", "deliver"];

describe("workplace story consequences", () => {
  it("makes the disruption happen once, after work exists", () => {
    expect(freshStory().request).toBe("unheard");
    const s = play(...opening);
    expect(s.request).toBe("pending"); expect(clockTime(s.minutes)).toBe("09:25");
    expect(moodFor("sam", s)).toBe("concerned");
    expect(storyChoices("sam", s).map(c => c.id)).toEqual(["confirm-room", "online-room", "decline-change"]);
    const resolved = advanceStory(s, "confirm-room");
    expect(advanceStory(resolved, "review").request).toBe("confirmed");
  });
  it("changes the actual artifact and permits two viable responses to uncertainty", () => {
    const confirmed = play(...opening, "confirm-room", "draft", "review", "extension", ...production);
    const online = play(...opening, "online-room", "draft", "review", ...production);
    expect(venueForStory(confirmed)).toContain("EAST HALL");
    expect(online.printedVenue).toContain("ROOM DETAILS ONLINE");
    expect(confirmed.minutes).toBeGreaterThan(online.minutes);
    expect(handoffOutcome(confirmed).accepted).toBe(true);
    expect(handoffOutcome(online).accepted).toBe(true);
    expect(handoffOutcome(confirmed).title).toBe("Something real leaves the studio.");
  });
  it("rejects the unchanged venue and catches a stale print after a late correction", () => {
    const unchanged = play(...opening, "decline-change", ...production);
    expect(handoffOutcome(unchanged).accepted).toBe(false);
    expect(storyChoices("sam", unchanged).some(c => c.id === "repair")).toBe(true);
    const stale = advanceStory(unchanged, "confirm-room");
    expect(handoffOutcome(stale).accepted).toBe(false);
  });
  it("a revision can miss the departure; negotiating time before delivery changes the ending", () => {
    const late = play(...opening, "confirm-room", "draft", "review", ...production);
    expect(late.minutes).toBeGreaterThan(late.deadline);
    expect(handoffOutcome(late).title).toBe("Good work. A missed departure.");
    const extended = play(...opening, "confirm-room", "draft", "review", "extension", ...production);
    expect(handoffOutcome(extended).title).toBe("Something real leaves the studio.");
    expect(advanceStory(extended, "extension")).toEqual(extended);
  });
  it("requires clearing the printer and does not double-charge repeated service actions", () => {
    const s = play(...opening, "online-room");
    expect(advanceStory(s, "print").printedVenue).toBeNull();
    const jam = advanceStory(s, "inspect-printer");
    expect(moodFor("alex", jam)).toBe("concerned");
    expect(advanceStory(jam, "inspect-printer")).toEqual(jam);
    const clear = advanceStory(jam, "clear-jam");
    expect(advanceStory(clear, "clear-jam")).toEqual(clear);
  });
});

describe("proof fidelity", () => {
  it("rejects unresolved layout issues and uses the correct spoken venue for online directions", () => {
    const finished = play(...opening, "online-room", "draft", "review", ...production);
    expect(handoffOutcome(finished).spoken).toContain("Room details online");
    expect(handoffOutcome(finished).spoken).not.toContain("East Hall");
    const illegible = { ...finished, printIssues: ["The booking line will be small in print. Try at least 14 pt."] };
    expect(handoffOutcome(illegible).accepted).toBe(false);
    expect(handoffOutcome(illegible).spoken).toContain("booking line");
  });
});

it("a confirmed brief does not silently edit the draft or the proof", () => {
  const confirmed = play(...opening, "confirm-room");
  expect(venueForStory(confirmed)).toContain("EAST HALL");
  expect(confirmed.draftVenue).toBe("LIBRARY FOYER");
  const staleProof = production.reduce(advanceStory, confirmed);
  expect(staleProof.printedVenue).toBe("LIBRARY FOYER");
  expect(handoffOutcome(staleProof).accepted).toBe(false);
  expect(advanceStory(confirmed, "draft").draftVenue).toContain("EAST HALL");
});
