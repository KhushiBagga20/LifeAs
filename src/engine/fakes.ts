import type { Rng } from "@/lib/rng";
import type { FakeProvider } from "@/llm/fake";
import type { ProviderRequest } from "@/llm/types";
import type { CompilerDraft } from "./compiler";
import type { CastSlot } from "./plan";
import type { Voice } from "./types";

// Realistic FakeLLM answers for the engine's AI calls, so the app is usable and testable without
// a real model. They read the brief the engine sends (JSON) and answer in kind. Real content
// comes from the real model; these only need to be plausible and valid.

type Brief = {
  career: { title: string; tasks: { id: number; task: string }[] };
  options: { level: string; workplace: string; location: string };
  cast: CastSlot[];
  week: { n: number; day: string; time: string; kind: string; kindOfWork: string }[];
};

const NAMES: Record<string, Record<"woman" | "man" | "nonbinary", string[]>> = {
  india: {
    woman: ["Ananya Rao", "Meera Iyer", "Priya Nair", "Kavya Menon", "Sana Qureshi", "Ritika Das"],
    man: ["Arjun Mehta", "Rohan Kulkarni", "Vikram Singh", "Kabir Shah", "Imran Sheikh", "Dev Patel"],
    nonbinary: ["Ari Bose", "Noor Kapoor", "Sam Varghese"],
  },
  uk: {
    woman: ["Hannah Clarke", "Amira Hussain", "Grace Okafor", "Sophie Turner", "Megan Hughes"],
    man: ["Tom Fletcher", "Oliver Bennett", "Kwame Asante", "Rhys Morgan", "Liam Walsh"],
    nonbinary: ["Alex Reid", "Jordan Price", "Robin Hale"],
  },
  generic: {
    woman: ["Maya Thompson", "Lucia Romero", "Aisha Bello", "Jenna Park", "Claire Dubois", "Nadia Haddad"],
    man: ["Marcus Lee", "Daniel Okoye", "Ethan Brooks", "Mateo Silva", "Sam Whitfield", "Jonah Kim"],
    nonbinary: ["Riley Chen", "Quinn Alvarez", "Avery Stone"],
  },
};

function region(location: string): keyof typeof NAMES {
  const l = location.toLowerCase();
  if (/india|mumbai|pune|delhi|bengaluru|bangalore|chennai|hyderabad|kolkata/.test(l)) return "india";
  if (/uk|london|manchester|england|scotland|wales|birmingham/.test(l)) return "uk";
  return "generic";
}

const CURRENCY: Record<keyof typeof NAMES, string> = { india: "INR", uk: "GBP", generic: "USD" };

// Rooms and outsiders by the kind of job, matched on words in the O*NET title.
const WORKPLACES: { match: RegExp; place: string; rooms: [string, string, string][]; outsider: string }[] = [
  {
    match: /nurse|physician|medical|health|therap|surgeon/i,
    place: "City General Hospital",
    rooms: [["ward", "Ward 4B", "ward"], ["station", "Nurses' station", "nurses-station"], ["breakroom", "Staff room", "break-room"]],
    outsider: "Patient",
  },
  {
    match: /electric|plumb|carpent|construct|mechanic|install|repair/i,
    place: "Brightline Electrical",
    rooms: [["site", "Apartment site, Block C", "site"], ["siteoffice", "Site office", "site-office"], ["workshop", "Workshop", "workshop"]],
    outsider: "Site client",
  },
  {
    match: /designer|artist|animator|graphic|illustrat/i,
    place: "Northlight Studio",
    rooms: [["studio", "The studio", "studio"], ["meeting", "Glass meeting room", "meeting-room"], ["kitchen", "Kitchen", "break-room"]],
    outsider: "Client",
  },
  {
    match: /lawyer|judge|paralegal|legal/i,
    place: "Hartley & Rao LLP",
    rooms: [["office", "Your office", "private-office"], ["meeting", "Conference room", "meeting-room"], ["court", "District Court, Room 3", "courtroom"]],
    outsider: "Client",
  },
  {
    match: /chef|cook|food/i,
    place: "Saffron & Salt",
    rooms: [["kitchen", "Kitchen", "commercial-kitchen"], ["dining", "Dining room", "dining-room"], ["stock", "Stockroom", "stockroom"]],
    outsider: "Supplier",
  },
  {
    match: /teacher|instructor|tutor/i,
    place: "Riverside School",
    rooms: [["classroom", "Room 12", "classroom"], ["staffroom", "Staff room", "staff-room"], ["library", "Library", "library"]],
    outsider: "Parent",
  },
];
const OFFICE = {
  place: "Fairway & Co",
  rooms: [["desks", "Open office", "open-office"], ["meeting", "Meeting room", "meeting-room"], ["kitchen", "Kitchen", "break-room"]] as [string, string, string][],
  outsider: "Client",
};

const singular = (title: string) => title.split(/,| and /)[0].replace(/s$/, "");
const shorten = (text: string, max = 58) => (text.length <= max ? text : `${text.slice(0, text.lastIndexOf(" ", max))}…`);

function voice(rng: Rng, languageMix: string): Voice {
  return {
    formality: rng.pick(["formal", "neutral", "casual"] as const),
    slang: rng.pick(["none", "some", "lots"] as const),
    languageMix,
    verbosity: rng.pick(["terse", "normal", "chatty"] as const),
    quirks: [rng.pick(["says 'right, so'", "answers questions with questions", "always mentions the time", "quotes old managers", "jokes when stressed", "sends voice notes"])],
  };
}

export function fakeCompilerDraft(request: ProviderRequest, rng: Rng): CompilerDraft {
  const brief = JSON.parse(request.messages[0].content) as Brief;
  const r = region(brief.options.location);
  const place = WORKPLACES.find((w) => w.match.test(brief.career.title)) ?? OFFICE;
  const job = singular(brief.career.title);
  const workKey = place.rooms[0][0];
  const used = new Set<string>();
  const languageMix = r === "india" ? "English with some Hindi" : "English";

  const cast = brief.cast.map((slot, i) => {
    const pool = NAMES[r][slot.gender].filter((n) => !used.has(n));
    const name = rng.pick(pool.length ? pool : NAMES.generic[slot.gender]);
    used.add(name);
    const role =
      slot.relation === "boss" ? `${job} lead` : slot.relation === "senior" ? `Senior ${job.toLowerCase()}` : slot.relation === "coworker" ? job : place.outsider;
    const v = voice(rng, languageMix);
    // Distinct voices by construction: formality, verbosity and slang step through their options.
    const offset = rng.int(0, 2);
    v.formality = (["formal", "neutral", "casual"] as const)[i % 3];
    v.verbosity = (["terse", "normal", "chatty"] as const)[(i + offset) % 3];
    v.slang = (["none", "some", "lots"] as const)[Math.floor(i / 3) % 3];
    return {
      id: slot.id,
      name,
      role,
      backstory: `${name.split(" ")[0]} has been around ${place.place} for a while and knows where the bodies are buried.`,
      wants: slot.relation === "outsider" ? "A straight answer and a quick fix." : "To get through the week without another surprise.",
      agenda: slot.relation === "boss" ? "Quietly hoping you'll take a problem off their plate." : "Wants credit for work they've been doing unnoticed.",
      voice: v,
      personality: {
        openness: Number(rng.float(0.2, 0.9).toFixed(2)),
        conscientiousness: Number(rng.float(0.2, 0.9).toFixed(2)),
        extraversion: Number(rng.float(0.2, 0.9).toFixed(2)),
        agreeableness: Number(rng.float(0.2, 0.9).toFixed(2)),
        neuroticism: Number(rng.float(0.1, 0.8).toFixed(2)),
      },
      workLocationKey: slot.relation === "outsider" ? null : rng.pick(place.rooms.slice(0, 2))[0],
    };
  });

  const insiders = brief.cast.filter((c) => c.relation !== "outsider").map((c) => c.id);
  const outsiders = brief.cast.filter((c) => c.relation === "outsider").map((c) => c.id);
  const moments = brief.week.map((slot, i) => {
    const task = brief.career.tasks[i % brief.career.tasks.length];
    const people =
      slot.kind === "routine"
        ? rng.chance(0.5) ? [rng.pick(insiders)] : []
        : slot.kind === "pressure" && outsiders.length
          ? [rng.pick(outsiders), rng.pick(insiders)]
          : rng.shuffle(insiders).slice(0, rng.int(1, 2));
    const room = slot.kind === "conversation" ? place.rooms[1][0] : slot.kind === "routine" && i === 0 ? workKey : rng.pick(place.rooms)[0];
    return {
      n: slot.n,
      title: shorten(task.task.replace(/\.$/, "")),
      locationKey: room,
      castIds: [...new Set(people)],
      onetTaskId: task.id,
      setup: `${slot.day} ${slot.time}. ${task.task}`,
      stakes:
        slot.kind === "pressure"
          ? "If this goes wrong, everyone will hear about it by lunch."
          : slot.kind === "routine"
            ? "Nobody will thank you for it, but skipping it causes trouble later."
            : "How you handle this changes how people see you this week.",
      task:
        slot.kind === "task"
          ? {
              type: "write" as const,
              prompt: `In three or four lines: ${task.task.charAt(0).toLowerCase()}${task.task.slice(1)}`,
              items: [],
              rubric: ["Clear and specific", "Gets the priorities right", "Appropriate for who will read it"],
            }
          : null,
    };
  });

  return {
    setting: {
      organisation: place.place,
      place: brief.options.location || "Riverside",
      description: `A busy ${brief.options.workplace || "workplace"} where ${brief.career.title.toLowerCase()} keep things running.`,
      cultureNotes: "People are friendly but stretched; things get decided in hallways as often as in meetings.",
      currency: CURRENCY[r],
    },
    cafeName: r === "india" ? "Chai Point" : "The Corner Café",
    you: {
      title: `${brief.options.level === "intern" ? "Intern" : brief.options.level === "experienced" ? "Senior" : "Junior"} ${job.toLowerCase()}`,
      responsibilities: brief.career.tasks.slice(0, 3).map((t) => shorten(t.task, 80)),
      workLocationKey: workKey,
    },
    cast,
    locations: place.rooms.map(([key, name, kind], i) => ({ key, name, kind: kind as CompilerDraft["locations"][number]["kind"], size: i === 0 ? "large" : "medium" })),
    meters: [
      { key: "trust", name: "Team trust", meaning: "How much your colleagues rely on you.", start: 50 },
      { key: "backlog", name: "Work under control", meaning: "How on top of the week's work you are.", start: 55 },
    ],
    moments,
  };
}

export function registerEngineFakers(fake: FakeProvider): FakeProvider {
  return fake.register("compile-workplace", fakeCompilerDraft).register("compile-workplace-repair", fakeCompilerDraft);
}
