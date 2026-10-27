// The roles of Block C (DESIGN.md §1.1). Shared by the engine, the AI and the screens.

export const roleIds = ["neighbour", "crew", "boss", "undercover", "medic", "influencer"] as const;
export type RoleId = (typeof roleIds)[number];

export type Team = "block" | "crew" | "solo";

export type RoleInfo = {
  id: RoleId;
  name: string;
  team: Team;
  /** One line: what this role is. */
  blurb: string;
  /** What the role does at night, or null. */
  night: string | null;
  /** How this role wins. */
  goal: string;
};

export const roles: Record<RoleId, RoleInfo> = {
  neighbour: {
    id: "neighbour",
    name: "Neighbour",
    team: "block",
    blurb: "You live here. You know something's wrong.",
    night: null,
    goal: "Vote every crew member out.",
  },
  crew: {
    id: "crew",
    name: "Crew",
    team: "crew",
    blurb: "You run with the crew. Nobody can know.",
    night: "Pick someone to take out, together with the rest of the crew.",
    goal: "Outnumber everyone else.",
  },
  boss: {
    id: "boss",
    name: "Boss",
    team: "crew",
    blurb: "You run the crew, and you look clean on paper.",
    night: "Pick a target with the crew. Your vote breaks ties. The Undercover sees you as clear.",
    goal: "Outnumber everyone else.",
  },
  undercover: {
    id: "undercover",
    name: "Undercover",
    team: "block",
    blurb: "A cop living under a fake name in 3A.",
    night: "Check one person: crew or clear.",
    goal: "Vote every crew member out.",
  },
  medic: {
    id: "medic",
    name: "Medic",
    team: "block",
    blurb: "Night-shift paramedic. You hear everything.",
    night: "Protect one person. Not the same person two nights running.",
    goal: "Vote every crew member out.",
  },
  influencer: {
    id: "influencer",
    name: "Influencer",
    team: "solo",
    blurb: "Any publicity is good publicity.",
    night: null,
    goal: "Get voted out by the block. You go viral; the game carries on.",
  },
};

export const isCrew = (role: RoleId) => roles[role].team === "crew";
