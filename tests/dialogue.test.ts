import { describe, expect, it } from "vitest";
import { conversationFraming } from "@/world/camera";
import { conversationPrompts, greetingFor, localReply } from "@/world/dialogue";
import { agentIds } from "@/world/simulation";

describe("story scene content and framing", () => {
  it("answers every suggested topic in local mode", () => {
    for (const agent of agentIds) {
      expect(greetingFor(agent, "arrive").length).toBeGreaterThan(40);
      for (const prompt of conversationPrompts[agent]) expect(localReply(agent, prompt)).toBeTruthy();
    }
  });
  it("frames the actor relative to their real world position and leaves room for dialogue", () => {
    const a = conversationFraming({ x: 0, z: 0 }, 1.6);
    const b = conversationFraming({ x: -5, z: 3 }, 1.6);
    expect(b.position.x - a.position.x).toBe(-5);
    expect(b.position.z - a.position.z).toBe(3);
    expect(b.lookAt).toEqual({ x: -5, y: 0.7, z: 3 });
    expect(conversationFraming({ x: 0, z: 0 }, 0.5).view).toBeGreaterThan(a.view);
  });
});

import { dialoguePages } from "@/world/dialogue";
it("splits long dialogue without dropping words or covering the portrait", () => {
  const line = "The foyer is closed. Facilities mentioned East Hall, but nobody has confirmed it. The volunteer leaves with the posters at ten. Can we still make this work?";
  const pages = dialoguePages(line, 100);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.every(page => page.length <= 100)).toBe(true);
  expect(pages.join(" ")).toBe(line);
});
