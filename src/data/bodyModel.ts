export type MuscleGroup = {
  id: string;
  label: string;
  short: string;
  side: "front" | "back" | "both";
  group: "push" | "pull" | "legs" | "core" | "mixed";
};

export const bodyMuscleGroups: MuscleGroup[] = [
  { id: "shoulders", label: "Schultern", short: "Delts", side: "front", group: "push" },
  { id: "chest", label: "Brust", short: "Chest", side: "front", group: "push" },
  { id: "arms", label: "Arme", short: "Arms", side: "both", group: "mixed" },
  { id: "back", label: "Ruecken", short: "Back", side: "back", group: "pull" },
  { id: "core", label: "Core", short: "Core", side: "front", group: "core" },
  { id: "glutes", label: "Gesaess", short: "Glutes", side: "back", group: "legs" },
  { id: "quads", label: "Quads", short: "Quads", side: "front", group: "legs" },
  { id: "hamstrings", label: "Hamstrings", short: "Hams", side: "back", group: "legs" },
  { id: "calves", label: "Waden", short: "Calves", side: "back", group: "legs" },
];

export const muscleGroups = bodyMuscleGroups;

export const trainingPlans = [
  {
    id: "push",
    name: "Push",
    label: "Push",
    groups: ["chest", "shoulders", "arms"],
    description: "Brust, Schultern und Arme. Sinnvoll, wenn Ruecken und Beine muede sind.",
  },
  {
    id: "pull",
    name: "Pull",
    label: "Pull",
    groups: ["back", "arms"],
    description: "Ruecken und Arme. Sinnvoll, wenn Push-Muskeln oder Beine belastet sind.",
  },
  {
    id: "legs",
    name: "Legs",
    label: "Legs",
    groups: ["quads", "hamstrings", "glutes", "calves"],
    description: "Unterkoerper. Nur sinnvoll, wenn Schmerz und Muskelkater niedrig sind.",
  },
  {
    id: "upperLight",
    name: "Light Upper",
    label: "Light upper",
    groups: ["chest", "back", "arms"],
    description: "Kurzer Oberkoerper-Tag bei hohem Stress oder mittlerer Recovery.",
  },
  {
    id: "mobility",
    name: "Mobility / Zone 2",
    label: "Mobility / zone 2",
    groups: ["core", "glutes"],
    description: "Leicht bewegen, wenn Schmerz oder systemische Ermuedung hoch ist.",
  },
];

export const musclePlans = trainingPlans;
