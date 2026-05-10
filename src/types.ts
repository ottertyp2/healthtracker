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
  category: "standard" | "generic" | "product" | "gemini";
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
  confidence?: "high" | "medium" | "needs-gemini";
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
  confidence: "high" | "medium" | "needs-gemini";
  photo?: MealPhoto;
  notes?: string;
  geminiResearch?: {
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
  shortcutToken: string;
  googleDriveFolderId?: string;
  createdAt: string;
  updatedAt: string;
};

export type GeminiTaskAction = {
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
  source: "manual" | "gemini" | "suggested";
  geminiRunId?: string;
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

export type DataQualityLevel = "low" | "medium" | "high";

export type DailyFact = {
  id: string;
  date: string;

  sleepHours?: number;
  sleepStart?: string;
  sleepEnd?: string;
  sleepDebt7d?: number;
  restingHeartRate?: number;
  steps?: number;

  energy?: number;
  focus?: number;
  stress?: number;
  sleepQuality?: number;

  caffeineTotalMg?: number;
  caffeineAfter14Mg?: number;
  lastCaffeineTime?: string;

  kcal?: number;
  protein?: number;
  proteinBefore12g?: number;
  fiber?: number;
  magnesium?: number;
  potassium?: number;
  vitaminD?: number;
  omega3?: number;

  firstProteinTime?: string;
  lastMealTime?: string;
  mealRegularityScore?: number;

  trainingLoad?: number;
  trainedMuscles?: string[];
  sorenessLoad?: number;
  painLoad?: number;

  isHome?: boolean;
  deepWorkMinutes?: number;
  studyMinutes?: number;

  dataQuality: {
    nutrition: DataQualityLevel;
    sleep: DataQualityLevel;
    subjective: DataQualityLevel;
  };
};

export type HealthHypothesis = {
  id: string;
  title: string;

  causeMetric: string;
  outcomeMetric: string;
  lagDays: 0 | 1 | 2;

  direction: "higher_is_better" | "lower_is_better";
  minObservations: number;

  observations: number;
  effectEstimate?: number;
  confidence: "insufficient" | "weak" | "medium" | "strong";

  evidenceSummary: string;
  counterEvidence?: string;

  suggestedExperiment?: {
    action: string;
    durationDays: number;
    successMetric: string;
  };

  status: "watching" | "testing" | "confirmed" | "rejected";
  updatedAt: string;
};

export type Intervention = {
  id: string;
  createdAt: string;
  trigger: string;
  hypothesisId?: string;

  recommendation: string;
  expectedBenefit: string;
  friction: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";

  actionWindow?: {
    start: string;
    end: string;
  };

  userResponse?: "accepted" | "ignored" | "rejected" | "completed";

  outcomeMetrics?: {
    focus?: number;
    energy?: number;
    sleepHours?: number;
    stress?: number;
  };

  result?: "helped" | "neutral" | "hurt" | "unknown";
};

export type InsightCard = {
  id: string;
  createdAt: string;
  title: string;
  claim: string;

  evidence: string[];
  counterEvidence: string[];

  confidence: "insufficient" | "weak" | "medium" | "strong";
  action?: string;
  experiment?: string;

  dismissReason?: string;
  userRating?: "useful" | "not_useful";
};

export type GeminiRun = {
  id: string;
  createdAt: string;
  summary: string;

  insightUpdates?: InsightCard[];
  hypothesisUpdates?: HealthHypothesis[];
  interventionActions?: Intervention[];

  calendarActions: string[];
  taskActions: Array<string | GeminiTaskAction>;

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

  source?: string;
  mode?: "noop" | "intervention" | "nutrition_pending" | string;
  runHourKey?: string;
};

export type MealType = MealEntry["mealType"];
