// Plain-language labels for O*NET® job zones and the work-context items a career page shows.

/** "Emergency Department RN (Emergency Department Registered Nurse)" → "Emergency Department RN" */
export const shortTitle = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, "") || title;

export const jobZoneLabels: Record<number, string> = {
  2: "Little to some preparation",
  3: "Medium preparation",
  4: "Considerable preparation",
  5: "Extensive preparation",
};

export const contextGroups: { title: string; items: { id: string; label: string }[] }[] = [
  {
    title: "People",
    items: [
      { id: "4.C.1.a.2.l", label: "Face-to-face conversations" },
      { id: "4.C.1.b.1.e", label: "Working in a team" },
      { id: "4.C.1.b.1.f", label: "Dealing with the public" },
      { id: "4.C.1.d.1", label: "Conflict" },
      { id: "4.C.1.d.2", label: "Unpleasant or angry people" },
      { id: "4.C.1.a.2.h", label: "Email" },
      { id: "4.C.1.a.2.c", label: "Public speaking" },
    ],
  },
  {
    title: "Pressure",
    items: [
      { id: "4.C.3.d.1", label: "Time pressure" },
      { id: "4.C.3.a.1", label: "When a mistake happens" },
      { id: "4.C.3.a.4", label: "Freedom to make decisions" },
      { id: "4.C.3.b.7", label: "Repeating the same tasks" },
    ],
  },
  {
    title: "Body and place",
    items: [
      { id: "4.C.2.d.1.a", label: "Sitting" },
      { id: "4.C.2.d.1.b", label: "Standing" },
      { id: "4.C.2.a.1.a", label: "Indoors, climate-controlled" },
      { id: "4.C.2.a.1.c", label: "Outdoors in all weather" },
      { id: "4.C.2.c.1.b", label: "Exposed to disease or infection" },
      { id: "4.C.2.c.1.d", label: "Hazardous conditions" },
    ],
  },
  {
    title: "Hours",
    items: [
      { id: "4.C.3.d.8", label: "Typical work week" },
      { id: "4.C.3.d.4", label: "Schedule" },
    ],
  },
];
