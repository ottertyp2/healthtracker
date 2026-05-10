export const trackedNutrientKeys = [
  "kcal",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "sugar",
  "starch",
  "netCarbs",
  "saturatedFat",
  "monounsaturatedFat",
  "polyunsaturatedFat",
  "transFat",
  "omega3",
  "omega6",
  "epa",
  "dha",
  "ala",
  "cholesterol",
  "sodium",
  "salt",
  "potassium",
  "calcium",
  "magnesium",
  "phosphorus",
  "iron",
  "zinc",
  "iodine",
  "selenium",
  "copper",
  "manganese",
  "chromium",
  "molybdenum",
  "vitaminA",
  "retinol",
  "betaCarotene",
  "vitaminB1",
  "vitaminB2",
  "vitaminB3",
  "vitaminB5",
  "vitaminB6",
  "biotin",
  "folate",
  "vitaminB12",
  "vitaminC",
  "vitaminD",
  "vitaminE",
  "vitaminK",
  "choline",
  "caffeine",
] as const;

export type TrackedNutrientKey = (typeof trackedNutrientKeys)[number];

export type TabKey =
  | "today"
  | "food"
  | "shopping"
  | "health"
  | "training"
  | "supplements"
  | "home"
  | "automation"
  | "insights";

export type TabId = TabKey;

export type Nutrients = Record<"kcal" | "protein" | "carbs" | "fat", number> &
  Partial<Record<Exclude<TrackedNutrientKey, "kcal" | "protein" | "carbs" | "fat">, number>>;

export type FoodReference = {
  id: string;
  name: string;
  aliases: string[];
  category: "standard" | "generic" | "product" | "agent";
  nutrientsPer100g: Nutrients;
  source: string;
};

export type MealItem = {
  id?: string;
  name: string;
  grams: number;
  foodRefId?: string;
  nutrients?: Nutrients;
  source?: string;
  confidence?: "high" | "medium" | "needs-agent";
};

export type MealPhoto = {
  driveFileId?: string;
  webViewLink?: string;
  thumbnail?: string;
  name?: string;
};

export type MealEntry = {
  id: string;
  date: string;
  capturedAt?: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  mode?: "template" | "weighed" | "freeText" | "barcode" | "photo";
  description: string;
  items: MealItem[];
  total?: Nutrients;
  nutritionEstimate?: Nutrients;
  confidence: "high" | "medium" | "needs-agent";
  photo?: MealPhoto;
  notes?: string;
  agentResearch?: {
    status: "queued" | "applied" | "rejected";
    requestedAt?: string;
    updatedAt?: string;
    sources?: string[];
    notes?: string;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type DailyLog = {
  id: string;
  date: string;
  readiness?: number;
  energy?: number;
  fitness?: number;
  stress: number;
  focus: number;
  caffeineMg: number;
  sleepQuality?: number;
  workload?: number;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
};

export type HealthImport = {
  id: string;
  date: string;
  sleepHours?: number;
  sleepStart?: string;
  sleepEnd?: string;
  weightKg?: number;
  bodyFatPct?: number;
  steps?: number;
  restingHeartRate?: number;
  source: "manual" | "ios-shortcut" | "iosShortcut" | "apple-health-export";
  raw?: unknown;
  importedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SupplementLog = {
  id: string;
  date: string;
  name: string;
  dose: string;
  taken?: boolean;
  time?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TrainingSession = {
  id: string;
  date: string;
  type?: string;
  planName?: string;
  muscleGroups: string[];
  intensity: number;
  durationMin?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type HomeDay = {
  id: string;
  date: string;
  status?: "home" | "away" | "unknown";
  isHome?: boolean;
  plannedMeals?: Array<"breakfast" | "lunch" | "dinner" | "snack">;
  mealPlan?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type MuscleStatus = {
  soreness: number;
  pain: number;
};

export type BodyStatus = {
  id: string;
  date: string;
  muscles: Record<string, MuscleStatus>;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AutomationSettings = {
  ownerUid?: string;
  agentToken: string;
  shortcutToken: string;
  googleDriveFolderId?: string;
  googleTasksListId?: string;
  googleTasksListTitle?: string;
  googleTasksSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentTaskAction = {
  action: "add" | "update" | "delete" | "check" | "note";
  target: string;
  item: string;
  reason?: string;
  priority?: "low" | "medium" | "high" | string;
};

export type ShoppingListItem = {
  id: string;
  title: string;
  quantity?: string;
  category?: string;
  reason?: string;
  priority: "low" | "medium" | "high";
  status: "open" | "checked";
  source: "manual" | "agent" | "suggested";
  agentRunId?: string;
  createdAt?: string;
  updatedAt?: string;
  checkedAt?: string;
};

export type AppData = {
  dailyLogs: DailyLog[];
  healthImports: HealthImport[];
  mealEntries: MealEntry[];
  supplements: SupplementLog[];
  trainingSessions: TrainingSession[];
  homeDays: HomeDay[];
  bodyStatuses: BodyStatus[];
  foodReferences: FoodReference[];
  shoppingList: ShoppingListItem[];
};

export type AgentRun = {
  id: string;
  createdAt: string;
  summary: string;
  calendarActions: string[];
  taskActions: Array<string | AgentTaskAction>;
  nutritionUpdates?: Array<{
    mealId: string;
    nutrients: Nutrients;
    confidence: "high" | "medium";
    assumptions?: string;
    sources?: string[];
  }>;
  keepActions?: string[];
  warnings: string[];
  nextPriorities: string[];
};

export type MealType = MealEntry["mealType"];
