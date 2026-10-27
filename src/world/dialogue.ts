import type { AgentId, Phase } from "./simulation";

export const conversationPrompts: Record<AgentId, string[]> = {
  maya: ["What should stand out first?", "Can you look at my layout?"],
  alex: ["What should I check before printing?", "How do I prepare the handoff?"],
  sam: ["Who is this poster for?", "Which details are essential?"],
};
export function greetingFor(agent: AgentId, phase: Phase): string {
  if (agent === "maya") return phase === "arrive"
    ? "You must be our new designer. I’m Maya. Before we open any tools, come and meet the person we’re making this for. Sam’s brought a brief from the library."
    : "There you are. Step away from the screen for a moment. Tell me—what do you want somebody to notice first when they walk past your poster?";
  if (agent === "alex") return "Hey, I’m Alex. I turn the things on our screens into things people can hold. The printer and I have reached an uneasy truce. What are you working on?";
  return phase === "complete"
    ? "There it is. An actual poster for the library wall. Thank you for seeing it through—now let’s get some people fixing things on Saturday."
    : "Hi! I’m Sam, from Central Library. We’re running a repair café this Saturday. I want people to see the poster and think, ‘Maybe I don’t have to throw that thing away.’";
}

// Local dialogue acknowledges the topic instead of repeating an unrelated mission hint.
export function localReply(agent: AgentId, message: string): string | null {
  const text = message.toLowerCase();
  if (agent === "maya" && /stand out|first|headline|hierarchy/.test(text)) return "The event name first. Then when and where. Finally, one clear way to book. You can give it personality, but don’t make someone solve a puzzle to find the date.";
  if (agent === "maya" && /layout|review|look at|feedback/.test(text)) return "Pin your draft on the review wall. We’ll check the reading order, the space between blocks, and whether the booking line holds up at a distance. Show me the work before you explain it.";
  if (agent === "alex" && /before printing|check|print/.test(text)) return "Check the date, venue and booking address against the brief. Then look at the type at actual size. A tiny mistake on screen becomes a hundred tiny mistakes on paper.";
  if (agent === "alex" && /handoff|prepare|deliver|proof/.test(text)) return "Make the draft, get Maya’s review, then print a proof. Pick it up from the tray and bring it to Sam yourself. We want the client approving the thing that will actually go on the wall.";
  if (agent === "sam" && /who|audience|for\?/.test(text)) return "People from around the neighbourhood—especially someone who’s never been to a repair café. They don’t need technical knowledge. They just need a broken household item and a booked slot.";
  if (agent === "sam" && /details|essential|when|where|date/.test(text)) return "Saturday, ten until two, at Central Library. Bring one broken household item. And please make ‘Book a free slot’ easy to see—we’ve only got so many repair tables.";
  return null;
}

// Keep mobile story beats short enough to leave the character's face and gestures visible.
export function dialoguePages(text: string, limit = 150): string[] {
  const units: string[] = [];
  for (const sentence of text.trim().split(/(?<=[.!?])\s+/)) {
    let part = "";
    for (const word of sentence.split(/\s+/).filter(Boolean)) {
      if (part && part.length + word.length + 1 > limit) { units.push(part); part = word; }
      else part += `${part ? " " : ""}${word}`;
    }
    if (part) units.push(part);
  }
  const pages: string[] = [];
  let page = "";
  for (const unit of units) {
    if (page && page.length + unit.length + 1 > limit) { pages.push(page); page = unit; }
    else page += `${page ? " " : ""}${unit}`;
  }
  if (page) pages.push(page);
  return pages.length ? pages : [""];
}
