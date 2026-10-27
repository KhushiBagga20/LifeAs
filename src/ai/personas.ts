import { createRng } from "@/lib/rng";

// AI neighbours' personas (DESIGN.md §2.1), built in code from the seed: who they are and how
// they text. The model uses these as the voice; the brain uses the traits.

export const traits = ["suspicious", "chatty", "quiet", "logical", "dramatic", "chill"] as const;
export type Trait = (typeof traits)[number];

export const textStyles = ["lowercase-emoji", "proper", "all-energy", "dry"] as const;
export type TextStyle = (typeof textStyles)[number];

export type Persona = {
  name: string;
  age: number;
  flat: string;
  job: string;
  style: TextStyle;
  trait: Trait;
  /** A habit that shows in how they write, e.g. "ends with 'just saying'". */
  quirk: string;
  /** Body colours for the 3D figure. */
  look: { top: string; skin: string; hair: string; hat: boolean };
};

const FIRST = [
  "Maya", "Dev", "Rosa", "Kofi", "Lena", "Arjun", "Zoe", "Tariq", "Mei", "Jonah", "Priya", "Luca",
  "Amara", "Nico", "Sana", "Ezra", "Ines", "Ravi", "Hana", "Omar", "Tess", "Kai", "Noor", "Felix",
];
const JOBS = [
  "barista", "night-bus driver", "nurse", "student", "delivery rider", "hairdresser", "accountant",
  "line cook", "personal trainer", "retired teacher", "tattoo artist", "software tester", "DJ",
  "pharmacist", "concierge", "dog walker", "estate agent", "mechanic",
];
const QUIRKS = [
  "ends messages with 'just saying'",
  "asks a question back when accused",
  "brings up the CCTV on 4th street",
  "calls everyone by their flat number",
  "types 'ok but' before every point",
  "uses way too many 👀",
  "quotes things people said earlier",
  "always mentions how tired they are",
];
const TOPS = ["#3b6fd8", "#d8553b", "#2f9e6e", "#8a4fd8", "#d8a23b", "#3bb3d8", "#d83b8a", "#6b7d8f", "#c9c2b3", "#1f2a3d"];
const SKINS = ["#f1c9a5", "#e0ac84", "#c68a5e", "#a26c45", "#7a4e31", "#5a3825"];
const HAIRS = ["#1b1714", "#3b2618", "#6b4423", "#b78a4a", "#d9c7a1", "#7a7a7a", "#a33b2a"];

/** Personas for the AI seats, distinct names avoiding any taken by humans. */
export function personasFor(seed: string, count: number, taken: string[] = []): Persona[] {
  const rng = createRng(`${seed}/personas`);
  const names = rng.shuffle(FIRST.filter((n) => !taken.some((t) => t.trim().toLowerCase() === n.toLowerCase())));
  const flats = rng.shuffle(["1A", "1B", "1C", "2A", "2B", "2C", "3A", "3B", "3C", "4A", "4B", "4C", "5A", "5B", "5C"]);
  return Array.from({ length: count }, (_, i) => ({
    name: names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ""),
    age: rng.int(19, 71),
    flat: flats[i % flats.length],
    job: rng.pick(JOBS),
    style: textStyles[(i + rng.int(0, 3)) % textStyles.length],
    trait: traits[(i + rng.int(0, 5)) % traits.length],
    quirk: rng.pick(QUIRKS),
    look: { top: rng.pick(TOPS), skin: rng.pick(SKINS), hair: rng.pick(HAIRS), hat: rng.chance(0.3) },
  }));
}
