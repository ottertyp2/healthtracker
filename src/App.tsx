import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  Activity,
  Apple,
  BarChart3,
  Battery,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  Dumbbell,
  Edit3,
  FileJson,
  Flame,
  Gauge,
  HeartPulse,
  Home,
  Loader2,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Salad,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  SunMedium,
  Trash2,
  UploadCloud,
  Utensils,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, User } from "firebase/auth";
import { app, auth, db, googleProvider, hasFirebaseConfig } from "./firebase";
import { bodyMuscleGroups, trainingPlans } from "./data/bodyModel";
import {
  defaultFoods,
  findFoodReference,
  mealTemplates,
  mergeNutrients,
  scaledNutrients,
  zeroNutrients,
} from "./data/defaultFoods";
import { todayKey, addDays, displayDate, nowIso, sortByDateDesc } from "./lib/date";
import { classNames, clamp, nutrientLine, round } from "./lib/format";
import { buildEvidenceEngineSnapshot } from "./lib/evidence";
import {
  averageBodyLoad,
  calculateRecoveryScore,
  latestByDate,
  recommendGymDay,
} from "./lib/recovery";
import { lookupBarcode } from "./lib/openFoodFacts";
import { prepareMealPhoto } from "./lib/photos";
import { createDrivePhotoClient, DrivePhotoUploadResult } from "./lib/drive";
import { googleOAuthClientId, hasGoogleOAuthClient } from "./lib/googleAuth";
import {
  type GeminiTaskAction,
  trackedNutrientKeys,
  type GeminiRun,
  type AppData,
  type AutomationSettings,
  type BodyStatus,
  type DailyLog,
  type FoodReference,
  type HealthImport,
  type HomeDay,
  type MealEntry,
  type MealItem,
  type MealType,
  type Nutrients,
  type ShoppingListItem,
  type SupplementLog,
  type TabKey,
  type TrainingSession,
} from "./types";

type DataCollection = keyof AppData;
type Saveable = { id: string; [key: string]: unknown };
type Notice = { tone: "good" | "warn" | "info"; text: string };

const dataCollections: DataCollection[] = [
  "dailyLogs",
  "healthImports",
  "mealEntries",
  "supplements",
  "trainingSessions",
  "homeDays",
  "bodyStatuses",
  "foodReferences",
  "shoppingList",
];

const defaultTabs: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
  { key: "today", label: "Heute", icon: <SunMedium size={18} /> },
  { key: "food", label: "Essen", icon: <Utensils size={18} /> },
  { key: "shopping", label: "Liste", icon: <ShoppingCart size={18} /> },
  { key: "health", label: "Body", icon: <HeartPulse size={18} /> },
  { key: "training", label: "Gym", icon: <Dumbbell size={18} /> },
  { key: "supplements", label: "Supps", icon: <Activity size={18} /> },
  { key: "home", label: "Zuhause", icon: <Home size={18} /> },
  { key: "automation", label: "KI", icon: <Sparkles size={18} /> },
  { key: "insights", label: "Analyse", icon: <BarChart3 size={18} /> },
];

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const mealLabels: Record<MealType, string> = {
  breakfast: "Fruehstueck",
  lunch: "Mittag",
  dinner: "Abend",
  snack: "Snack",
};

const supplementOptions = [
  "Vitamin D",
  "Magnesium",
  "Omega 3",
  "Creatine",
  "Zink",
  "Jod",
  "Elektrolyte",
];

const localDataKey = "healthtracker.local.data.v1";
const localSettingsKey = "healthtracker.local.settings.v1";
const SHOPPING_LIST_TITLE = "Healthtracker Einkaufsliste";
const GEMINI_FUNCTIONS_REGION = "us-central1";

function createEmptyData(): AppData {
  return {
    dailyLogs: [],
    healthImports: [],
    mealEntries: [],
    supplements: [],
    trainingSessions: [],
    homeDays: [],
    bodyStatuses: [],
    foodReferences: [],
    shoppingList: [],
  };
}

function ensureAppData(value: Partial<AppData> | undefined): AppData {
  const empty = createEmptyData();
  return {
    dailyLogs: Array.isArray(value?.dailyLogs) ? value.dailyLogs : empty.dailyLogs,
    healthImports: Array.isArray(value?.healthImports) ? value.healthImports : empty.healthImports,
    mealEntries: Array.isArray(value?.mealEntries) ? value.mealEntries : empty.mealEntries,
    supplements: Array.isArray(value?.supplements) ? value.supplements : empty.supplements,
    trainingSessions: Array.isArray(value?.trainingSessions) ? value.trainingSessions : empty.trainingSessions,
    homeDays: Array.isArray(value?.homeDays) ? value.homeDays : empty.homeDays,
    bodyStatuses: Array.isArray(value?.bodyStatuses) ? value.bodyStatuses : empty.bodyStatuses,
    foodReferences: Array.isArray(value?.foodReferences) ? value.foodReferences : empty.foodReferences,
    shoppingList: Array.isArray(value?.shoppingList) ? value.shoppingList : empty.shoppingList,
  };
}

function createToken(prefix: string) {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function createDefaultSettings(ownerUid = "local"): AutomationSettings {
  return {
    ownerUid,
    shortcutToken: createToken("shortcut"),
    googleDriveFolderId: undefined,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeFirestore<T>(value: unknown): T {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString() as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFirestore(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeFirestore(item)]),
    ) as T;
  }

  return value as T;
}

function toFirestoreObject(item: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readNumberParam(params: URLSearchParams, key: string): number | undefined {
  const value = params.get(key);
  if (value === null || value.trim() === "") return undefined;
  const numeric = Number(value.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseHealthPayload(params: URLSearchParams): Partial<HealthImport> {
  const payload = params.get("healthPayload");
  if (!payload) return {};

  try {
    const decoded = decodeURIComponent(payload);
    return JSON.parse(decoded) as Partial<HealthImport>;
  } catch {
    try {
      return JSON.parse(atob(payload)) as Partial<HealthImport>;
    } catch {
      return {};
    }
  }
}

function buildHealthImportFromParams(params: URLSearchParams): HealthImport | undefined {
  const payload = parseHealthPayload(params);
  const date = String(payload.date ?? params.get("date") ?? todayKey());
  const sleepHours = Number(payload.sleepHours ?? readNumberParam(params, "sleepHours"));
  const weightKg = Number(payload.weightKg ?? readNumberParam(params, "weightKg"));
  const bodyFatPct = Number(payload.bodyFatPct ?? readNumberParam(params, "bodyFatPct"));
  const restingHeartRate = Number(payload.restingHeartRate ?? readNumberParam(params, "restingHeartRate"));
  const steps = Number(payload.steps ?? readNumberParam(params, "steps"));
  const sleepStart = typeof payload.sleepStart === "string" ? payload.sleepStart : params.get("sleepStart") ?? undefined;
  const sleepEnd = typeof payload.sleepEnd === "string" ? payload.sleepEnd : params.get("sleepEnd") ?? undefined;

  const importItem: HealthImport = {
    id: `shortcut-${date}-${Date.now()}`,
    date,
    source: "ios-shortcut",
    importedAt: nowIso(),
    sleepHours: Number.isFinite(sleepHours) ? sleepHours : undefined,
    sleepStart,
    sleepEnd,
    weightKg: Number.isFinite(weightKg) ? weightKg : undefined,
    bodyFatPct: Number.isFinite(bodyFatPct) ? bodyFatPct : undefined,
    restingHeartRate: Number.isFinite(restingHeartRate) ? restingHeartRate : undefined,
    steps: Number.isFinite(steps) ? steps : undefined,
    raw: payload.raw ?? undefined,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const hasData = [
    importItem.sleepHours,
    importItem.weightKg,
    importItem.bodyFatPct,
    importItem.restingHeartRate,
    importItem.steps,
    importItem.sleepStart,
    importItem.sleepEnd,
  ].some((value) => value !== undefined && value !== "");

  return hasData ? importItem : undefined;
}

function buildHealthShortcutUrl(token: string, payload?: Partial<HealthImport>) {
  const url = new URL(`${window.location.origin}${window.location.pathname}`);
  url.searchParams.set("shortcutToken", token);

  if (payload) {
    url.searchParams.set("healthPayload", JSON.stringify(payload));
  }

  return url.toString();
}

function combineFoodReferences(custom: FoodReference[]) {
  const customIds = new Set(custom.map((food) => food.id));
  return [...custom, ...defaultFoods.filter((food) => !customIds.has(food.id))];
}

function mealEntryNutrition(meal: MealEntry): Nutrients {
  const itemTotal = meal.items.reduce<Nutrients>(
    (sum, item) => mergeNutrients(sum, item.nutrients ?? zeroNutrients()),
    zeroNutrients(),
  );
  const hasItemNutrition = Object.values(itemTotal).some((value) => (value ?? 0) > 0);
  return hasItemNutrition ? itemTotal : meal.total ?? meal.nutritionEstimate ?? zeroNutrients();
}

function hasMeaningfulNutrition(nutrients?: Nutrients) {
  if (!nutrients) return false;
  return ["kcal", "protein", "carbs", "fat"].some((key) => (nutrients[key as keyof Nutrients] ?? 0) > 0);
}

function nutritionForDate(meals: MealEntry[], date: string): Nutrients {
  return meals
    .filter((meal) => meal.date === date)
    .reduce<Nutrients>((sum, meal) => mergeNutrients(sum, mealEntryNutrition(meal)), zeroNutrients());
}

function sumCalories(meals: MealEntry[], date: string) {
  return round(nutritionForDate(meals, date).kcal ?? 0);
}

function buildShoppingItems(data: AppData, fromDate = todayKey()): string[] {
  const nextHomeDays = Array.from({ length: 7 }, (_, index) => addDays(fromDate, index))
    .map((date) => data.homeDays.find((day) => day.date === date && day.isHome))
    .filter(Boolean) as HomeDay[];
  const plannedHomeDays = nextHomeDays.length
    ? nextHomeDays
    : [{ id: fromDate, date: fromDate, isHome: true, plannedMeals: ["breakfast", "lunch", "dinner"] }];
  const alreadyLogged = new Set(
    data.mealEntries
      .filter((meal) => meal.date >= fromDate)
      .flatMap((meal) => [meal.description, ...meal.items.map((item) => item.name)])
      .map((name) => name.toLocaleLowerCase("de-DE")),
  );
  const items = new Set<string>();

  for (const day of plannedHomeDays) {
    for (const meal of day.plannedMeals ?? ["lunch", "dinner"]) {
      if (meal === "breakfast") {
        ["Eier", "Bauernschnitte", "Butter", "Marmelade"].forEach((item) => items.add(item));
      }
      if (meal === "lunch") {
        ["Rinderhack oder Steak", "Kartoffeln", "Brot", "Basilikum"].forEach((item) => items.add(item));
      }
      if (meal === "dinner") {
        ["Gemuese fuer Abendessen", "Skyr oder Quark", "Obst"].forEach((item) => items.add(item));
      }
      if (meal === "snack") {
        ["Nuesse", "Obst"].forEach((item) => items.add(item));
      }
    }
  }

  const basics = ["Mineralwasser", "Salz", "Olivenoel"];
  basics.forEach((item) => items.add(item));
  return Array.from(items).filter((item) => !alreadyLogged.has(item.toLocaleLowerCase("de-DE"))).slice(0, 24);
}

function normalizeShoppingTitle(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

function normalizePriority(value?: string): ShoppingListItem["priority"] {
  if (value === "high" || value === "low") return value;
  return "medium";
}

function createShoppingListItem({
  title,
  quantity,
  reason,
  priority = "medium",
  source,
  geminiRunId,
}: {
  title: string;
  quantity?: string;
  reason?: string;
  priority?: string;
  source: ShoppingListItem["source"];
  geminiRunId?: string;
}): ShoppingListItem {
  return {
    id: `shop-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: title.trim(),
    quantity: quantity?.trim() || undefined,
    reason: reason?.trim() || undefined,
    priority: normalizePriority(priority),
    status: "open",
    source,
    geminiRunId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function parseGeminiTaskActions(value: unknown): GeminiTaskAction[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item === "string") {
      const text = item.trim();
      if (!text) return [];
      try {
        const parsed = JSON.parse(text) as unknown;
        return parseGeminiTaskActions(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        const addMatch = text.match(/^(add|hinzufuegen|\+)\s*[:\-]?\s*(.+)$/i);
        return [
          {
            action: addMatch ? "add" : "note",
            target: SHOPPING_LIST_TITLE,
            item: addMatch ? addMatch[2].trim() : text,
          },
        ];
      }
    }

    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<GeminiTaskAction>;
    if (typeof candidate.item !== "string" || !candidate.item.trim()) return [];
    const action = ["add", "update", "delete", "check", "note"].includes(String(candidate.action))
      ? (candidate.action as GeminiTaskAction["action"])
      : "note";
    return [
      {
        action,
        target: typeof candidate.target === "string" && candidate.target.trim() ? candidate.target : SHOPPING_LIST_TITLE,
        item: candidate.item.trim(),
        reason: typeof candidate.reason === "string" ? candidate.reason : undefined,
        priority: typeof candidate.priority === "string" ? candidate.priority : undefined,
      },
    ];
  });
}

function isShoppingAddAction(action: GeminiTaskAction) {
  return action.action === "add" && normalizeShoppingTitle(action.target).includes("einkauf");
}

function needsGeminiNutrition(meal: MealEntry) {
  return meal.confidence === "needs-gemini" || !hasMeaningfulNutrition(mealEntryNutrition(meal));
}

function buildNutritionResearchQueue(data: AppData) {
  return data.mealEntries
    .filter(needsGeminiNutrition)
    .sort(sortByDateDesc)
    .slice(0, 30)
    .map((meal) => ({
      mealId: meal.id,
      date: meal.date,
      mealType: meal.mealType,
      description: meal.description,
      provisionalNutrition: hasMeaningfulNutrition(mealEntryNutrition(meal)) ? mealEntryNutrition(meal) : undefined,
      existingSource: meal.items.map((item) => item.source).filter(Boolean).join(", "),
      items: meal.items.map((item) => ({
        name: item.name,
        grams: item.grams,
        source: item.source,
        confidence: item.confidence,
      })),
      photo: meal.photo
        ? {
            driveFileId: meal.photo.driveFileId,
            webViewLink: meal.photo.webViewLink,
            hasThumbnail: Boolean(meal.photo.thumbnail),
          }
        : undefined,
      requestedOutput: {
        mealId: meal.id,
        nutrients: trackedNutrientKeys.join(", "),
        confidence: "high or medium only; otherwise leave the meal queued",
        assumptions: "short text",
        sources: "URLs or product/database names used",
      },
    }));
}

function nextFullHour(date = new Date()) {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function formatTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function sanitizeGeminiNutrients(value: unknown): Nutrients | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<Record<keyof Nutrients, unknown>>;
  const nutrients = zeroNutrients();

  for (const key of trackedNutrientKeys) {
    const numeric = Number(source[key]);
    if (Number.isFinite(numeric) && numeric >= 0) {
      nutrients[key] = key === "kcal" ? clamp(numeric, 0, 6000) : clamp(numeric, 0, 100000);
    }
  }

  return hasMeaningfulNutrition(nutrients) ? nutrients : undefined;
}

function extractNutritionUpdates(run: GeminiRun) {
  return (run.nutritionUpdates ?? [])
    .map((update) => {
      const nutrients = sanitizeGeminiNutrients(update.nutrients);
      if (!update.mealId || !nutrients) return undefined;
      return {
        mealId: update.mealId,
        nutrients,
        confidence: update.confidence === "high" ? "high" : "medium",
        assumptions: update.assumptions,
        sources: update.sources?.filter(Boolean).slice(0, 6) ?? [],
      };
    })
    .filter(Boolean) as Array<{
    mealId: string;
    nutrients: Nutrients;
    confidence: "high" | "medium";
    assumptions?: string;
    sources: string[];
  }>;
}

function mapLoadColor(load: number) {
  if (load >= 7) return "load-high";
  if (load >= 4) return "load-mid";
  if (load > 0) return "load-low";
  return "";
}

function useAuthState() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(hasFirebaseConfig);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return undefined;
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  return { user, loading };
}

function useHealthStore(user: User | null) {
  const usingCloud = Boolean(hasFirebaseConfig && db && user);
  const [data, setData] = useState<AppData>(() => ensureAppData(readLocal(localDataKey, createEmptyData())));
  const [settings, setSettings] = useState<AutomationSettings>(() =>
    readLocal(localSettingsKey, createDefaultSettings()),
  );
  const [loading, setLoading] = useState(usingCloud);

  useEffect(() => {
    if (!usingCloud || !db || !user) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const activeDb = db;
    const uid = user.uid;
    const cleanups = dataCollections.map((name) =>
      onSnapshot(collection(activeDb, "users", uid, name), (snapshot) => {
        setData((previous) => ({
          ...previous,
          [name]: snapshot.docs.map((item) =>
            normalizeFirestore({ id: item.id, ...item.data() }),
          ),
        }));
        setLoading(false);
      }),
    );

    const settingsRef = doc(activeDb, "users", uid, "settings", "automation");
    const unsubscribeSettings = onSnapshot(settingsRef, async (snapshot) => {
      if (!snapshot.exists()) {
        const nextSettings = createDefaultSettings(uid);
        await setDoc(settingsRef, toFirestoreObject(nextSettings), { merge: true });
        setSettings(nextSettings);
        return;
      }

      setSettings(normalizeFirestore<AutomationSettings>({ ...snapshot.data(), ownerUid: uid }));
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      unsubscribeSettings();
    };
  }, [usingCloud, user]);

  useEffect(() => {
    if (!usingCloud) {
      writeLocal(localDataKey, data);
    }
  }, [data, usingCloud]);

  useEffect(() => {
    if (!usingCloud) {
      writeLocal(localSettingsKey, settings);
    }
  }, [settings, usingCloud]);

  async function saveItem<K extends DataCollection>(name: K, item: AppData[K][number] & Saveable) {
    if (usingCloud && db && user) {
      await setDoc(doc(db, "users", user.uid, name, item.id), toFirestoreObject(item), {
        merge: true,
      });
      return;
    }

    setData((previous) => {
      const list = previous[name] as Array<Saveable>;
      return {
        ...previous,
        [name]: [...list.filter((entry) => entry.id !== item.id), item],
      };
    });
  }

  async function removeItem<K extends DataCollection>(name: K, id: string) {
    if (usingCloud && db && user) {
      await deleteDoc(doc(db, "users", user.uid, name, id));
      return;
    }

    setData((previous) => {
      const list = previous[name] as Array<Saveable>;
      return {
        ...previous,
        [name]: list.filter((entry) => entry.id !== id),
      };
    });
  }

  async function saveSettings(nextSettings: AutomationSettings) {
    const value = { ...nextSettings, updatedAt: nowIso() };
    if (usingCloud && db && user) {
      await setDoc(doc(db, "users", user.uid, "settings", "automation"), toFirestoreObject(value), {
        merge: true,
      });
    }
    setSettings(value);
  }

  return {
    data,
    settings,
    loading,
    usingCloud,
    saveItem,
    removeItem,
    saveSettings,
  };
}

export default function App() {
  return <HealthApp />;
}

function HealthApp() {
  const { user, loading: authLoading } = useAuthState();
  const {
    data,
    settings,
    loading,
    usingCloud,
    saveItem,
    removeItem,
    saveSettings,
  } = useHealthStore(user);
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [notice, setNotice] = useState<Notice | null>(null);
  const today = todayKey();
  const foodReferences = useMemo(() => combineFoodReferences(data.foodReferences), [data.foodReferences]);
  const latestHealth = useMemo(() => latestByDate(data.healthImports), [data.healthImports]);
  const latestDailyLog = useMemo(() => latestByDate(data.dailyLogs), [data.dailyLogs]);
  const latestBodyStatus = useMemo(() => latestByDate(data.bodyStatuses), [data.bodyStatuses]);
  const todaysNutrition = useMemo(
    () => nutritionForDate(data.mealEntries, today),
    [data.mealEntries, today],
  );
  const recovery = useMemo(
    () =>
      calculateRecoveryScore({
        dailyLog: latestDailyLog,
        healthImport: latestHealth,
        bodyStatus: latestBodyStatus,
        trainingSessions: data.trainingSessions,
        today,
      }),
    [latestDailyLog, latestHealth, latestBodyStatus, data.trainingSessions, today],
  );
  const gymRecommendation = useMemo(
    () => recommendGymDay(latestBodyStatus, data.trainingSessions, today),
    [latestBodyStatus, data.trainingSessions, today],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shortcutToken = params.get("shortcutToken");
    if (!shortcutToken || !settings.shortcutToken || shortcutToken !== settings.shortcutToken) return;

    const importItem = buildHealthImportFromParams(params);
    if (!importItem) {
      setNotice({
        tone: "warn",
        text: "Shortcut geoeffnet, aber ohne echte Health-Werte. Fuege im iOS Shortcut Parameter wie sleepHours, steps, restingHeartRate, weightKg oder healthPayload hinzu.",
      });
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    void saveItem("healthImports", importItem).then(() => {
      setNotice({ tone: "good", text: "iPhone Health-Import wurde gespeichert." });
      window.history.replaceState({}, "", window.location.pathname);
    });
  }, [settings.shortcutToken, saveItem]);

  async function handleSignIn() {
    if (!auth || !googleProvider) return;
    await signInWithPopup(auth, googleProvider);
  }

  async function handleSignOut() {
    if (!auth) return;
    await auth.signOut();
  }

  if (authLoading) {
    return (
      <Shell>
        <LoadingState label="App wird vorbereitet" />
      </Shell>
    );
  }

  const currentScreen = {
    today: (
      <TodayScreen
        data={data}
        today={today}
        latestHealth={latestHealth}
        latestDailyLog={latestDailyLog}
        recovery={recovery}
        gymRecommendation={gymRecommendation}
        todaysNutrition={todaysNutrition}
        onDailySave={(item) => saveItem("dailyLogs", item)}
        onHealthSave={(item) => saveItem("healthImports", item)}
        onTab={setActiveTab}
      />
    ),
    food: (
      <FoodScreen
        data={data}
        foodReferences={foodReferences}
        today={today}
        settings={settings}
        usingCloud={usingCloud}
        onSaveMeal={(item) => saveItem("mealEntries", item)}
        onRemoveMeal={(id) => removeItem("mealEntries", id)}
        onSaveFoodReference={(item) => saveItem("foodReferences", item)}
        onSettings={saveSettings}
        onNotice={setNotice}
      />
    ),
    shopping: (
      <ShoppingScreen
        data={data}
        today={today}
        onSave={(item) => saveItem("shoppingList", item)}
        onRemove={(id) => removeItem("shoppingList", id)}
      />
    ),
    health: (
      <BodyScreen
        today={today}
        bodyStatus={latestBodyStatus}
        trainingSessions={data.trainingSessions}
        recommendation={gymRecommendation}
        onSave={(item) => saveItem("bodyStatuses", item)}
      />
    ),
    training: (
      <TrainingScreen
        today={today}
        sessions={data.trainingSessions}
        recommendation={gymRecommendation}
        onSave={(item) => saveItem("trainingSessions", item)}
        onRemove={(id) => removeItem("trainingSessions", id)}
      />
    ),
    supplements: (
      <SupplementsScreen
        today={today}
        logs={data.supplements}
        onSave={(item) => saveItem("supplements", item)}
        onRemove={(id) => removeItem("supplements", id)}
      />
    ),
    home: (
      <HomeDaysScreen
        today={today}
        homeDays={data.homeDays}
        meals={data.mealEntries}
        onSave={(item) => saveItem("homeDays", item)}
      />
    ),
    automation: (
      <AutomationScreen
        user={user}
        data={data}
        settings={settings}
        usingCloud={usingCloud}
        recovery={recovery}
        gymRecommendation={gymRecommendation}
        onSettings={saveSettings}
        onSaveMeal={(item) => saveItem("mealEntries", item)}
        onSaveShoppingItem={(item) => saveItem("shoppingList", item)}
        onNotice={setNotice}
      />
    ),
    insights: (
      <InsightsScreen
        data={data}
        today={today}
        recovery={recovery}
        gymRecommendation={gymRecommendation}
        todaysNutrition={todaysNutrition}
      />
    ),
  }[activeTab];

  return (
    <Shell>
      <header className="app-header">
        <button className="brand-button" onClick={() => setActiveTab("today")}>
          <span className="brand-mark">
            <Battery size={18} />
          </span>
          <span>
            <strong>Healthtracker</strong>
            <small>
              {usingCloud ? "Firebase Sync aktiv" : hasFirebaseConfig ? "Firebase Login bereit" : "Lokaler MVP-Modus"}
            </small>
          </span>
        </button>

        <div className="header-actions">
          {!hasFirebaseConfig && <Pill tone="warn">Firebase fehlt</Pill>}
          {hasFirebaseConfig && !user && (
            <button className="icon-text-button" onClick={handleSignIn}>
              <CircleUserRound size={17} />
              Login
            </button>
          )}
          {user && (
            <button className="icon-button" onClick={handleSignOut} aria-label="Abmelden" title="Abmelden">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>

      {notice && (
        <button className={classNames("notice", `notice-${notice.tone}`)} onClick={() => setNotice(null)}>
          {notice.text}
        </button>
      )}

      <div key={activeTab} className="screen-stage">
        {loading ? <LoadingState label="Daten werden geladen" /> : currentScreen}
      </div>

      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {defaultTabs.map((tab) => (
          <button
            key={tab.key}
            className={classNames(activeTab === tab.key && "active")}
            onClick={() => setActiveTab(tab.key)}
            title={tab.label}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="app-shell">
      <span className="ambient-orb ambient-orb-one" aria-hidden="true" />
      <span className="ambient-orb ambient-orb-two" aria-hidden="true" />
      {children}
    </main>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="loading-state">
      <Loader2 size={22} className="spin" />
      <span>{label}</span>
    </div>
  );
}

function Pill({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "good" | "warn" | "bad" }) {
  return <span className={classNames("pill", `pill-${tone}`)}>{children}</span>;
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  icon: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <section className={classNames("metric-card", `metric-${tone}`)}>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </section>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function TodayScreen({
  data,
  today,
  latestHealth,
  latestDailyLog,
  recovery,
  gymRecommendation,
  todaysNutrition,
  onDailySave,
  onHealthSave,
  onTab,
}: {
  data: AppData;
  today: string;
  latestHealth?: HealthImport;
  latestDailyLog?: DailyLog;
  recovery: ReturnType<typeof calculateRecoveryScore>;
  gymRecommendation: ReturnType<typeof recommendGymDay>;
  todaysNutrition: Nutrients;
  onDailySave: (item: DailyLog & Saveable) => Promise<void>;
  onHealthSave: (item: HealthImport & Saveable) => Promise<void>;
  onTab: (tab: TabKey) => void;
}) {
  const [fitness, setFitness] = useState(latestDailyLog?.fitness ?? 7);
  const [stress, setStress] = useState(latestDailyLog?.stress ?? 4);
  const [focus, setFocus] = useState(latestDailyLog?.focus ?? 7);
  const [caffeine, setCaffeine] = useState(latestDailyLog?.caffeineMg ?? 0);
  const [notes, setNotes] = useState(latestDailyLog?.notes ?? "");
  const [healthDate, setHealthDate] = useState(today);
  const [sleepHours, setSleepHours] = useState(latestHealth?.date === today ? latestHealth.sleepHours ?? 0 : 0);
  const [steps, setSteps] = useState(latestHealth?.date === today ? latestHealth.steps ?? 0 : 0);
  const [weightKg, setWeightKg] = useState(latestHealth?.date === today ? latestHealth.weightKg ?? 0 : 0);
  const [bodyFatPct, setBodyFatPct] = useState(latestHealth?.date === today ? latestHealth.bodyFatPct ?? 0 : 0);
  const [restingHeartRate, setRestingHeartRate] = useState(
    latestHealth?.date === today ? latestHealth.restingHeartRate ?? 0 : 0,
  );
  const homeToday = data.homeDays.find((day) => day.date === today);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onDailySave({
      id: today,
      date: today,
      fitness,
      stress,
      focus,
      caffeineMg: caffeine,
      notes,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  async function submitHealth(event: FormEvent) {
    event.preventDefault();
    const healthImport: HealthImport = {
      id: `health-${healthDate}-${Date.now()}`,
      date: healthDate,
      source: "manual",
      sleepHours: sleepHours > 0 ? sleepHours : undefined,
      steps: steps > 0 ? steps : undefined,
      weightKg: weightKg > 0 ? weightKg : undefined,
      bodyFatPct: bodyFatPct > 0 ? bodyFatPct : undefined,
      restingHeartRate: restingHeartRate > 0 ? restingHeartRate : undefined,
      importedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await onHealthSave(healthImport);
  }

  return (
    <div className="screen stack">
      <section className="today-hero">
        <div>
          <small>{displayDate(today)}</small>
          <h1>{recovery.label}</h1>
          <p>{recovery.summary}</p>
        </div>
        <div className={classNames("score-ring", `score-${recovery.color}`)}>
          <span>{recovery.score}</span>
          <small>/100</small>
        </div>
      </section>

      <div className="metric-grid">
        <MetricCard
          label="Schlaf"
          value={latestHealth?.sleepHours ? `${round(latestHealth.sleepHours, 1)} h` : "offen"}
          detail={latestHealth?.source === "iosShortcut" || latestHealth?.source === "ios-shortcut" ? "iPhone Import" : "manuell"}
          icon={<Moon size={18} />}
          tone={latestHealth?.sleepHours && latestHealth.sleepHours >= 7 ? "good" : "warn"}
        />
        <MetricCard
          label="Energie"
          value={`${latestDailyLog?.fitness ?? fitness}/10`}
          detail={`Stress ${latestDailyLog?.stress ?? stress}/10`}
          icon={<Gauge size={18} />}
          tone={recovery.score >= 75 ? "good" : recovery.score >= 55 ? "warn" : "bad"}
        />
        <MetricCard
          label="Essen"
          value={`${sumCalories(data.mealEntries, today)} kcal`}
          detail={nutrientLine(todaysNutrition)}
          icon={<Salad size={18} />}
        />
        <MetricCard
          label="Gym"
          value={gymRecommendation.planName}
          detail={gymRecommendation.reason}
          icon={<Dumbbell size={18} />}
          tone={gymRecommendation.recoveryNeeded ? "warn" : "good"}
        />
        <MetricCard
          label="KI"
          value={formatTime(nextFullHour())}
          detail="naechstes geplantes Update"
          icon={<Sparkles size={18} />}
          tone="good"
        />
      </div>

      <section className="action-strip">
        <button onClick={() => onTab("food")}>
          <Apple size={18} />
          Essen loggen
        </button>
        <button onClick={() => onTab("health")}>
          <HeartPulse size={18} />
          Schmerzen
        </button>
        <button onClick={() => onTab("training")}>
          <Dumbbell size={18} />
          Training
        </button>
      </section>

      <section className="panel">
        <SectionHeader title="Daily Check-in" />
        <form className="form-grid" onSubmit={submit}>
          <SliderField label="Fit" value={fitness} min={1} max={10} onChange={setFitness} />
          <SliderField label="Stress" value={stress} min={1} max={10} onChange={setStress} />
          <SliderField label="Fokus" value={focus} min={1} max={10} onChange={setFocus} />
          <label className="field">
            <span>Koffein mg</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={25}
              value={caffeine}
              onChange={(event) => setCaffeine(Number(event.target.value))}
            />
          </label>
          <label className="field field-wide">
            <span>Notiz</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>
          <button className="primary-button field-wide" type="submit">
            <ShieldCheck size={18} />
            Check-in speichern
          </button>
        </form>
      </section>

      <section className="panel">
        <SectionHeader title="Health Daten" action={<Pill tone={latestHealth ? "good" : "warn"}>{latestHealth ? displayDate(latestHealth.date) : "offen"}</Pill>} />
        <form className="form-grid" onSubmit={submitHealth}>
          <label className="field">
            <span>Datum</span>
            <input type="date" value={healthDate} onChange={(event) => setHealthDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Schlaf Stunden</span>
            <input type="number" min={0} step={0.1} value={sleepHours || ""} onChange={(event) => setSleepHours(Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Schritte</span>
            <input type="number" min={0} step={100} value={steps || ""} onChange={(event) => setSteps(Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Gewicht kg</span>
            <input type="number" min={0} step={0.1} value={weightKg || ""} onChange={(event) => setWeightKg(Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Koerperfett %</span>
            <input type="number" min={0} step={0.1} value={bodyFatPct || ""} onChange={(event) => setBodyFatPct(Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Ruhepuls</span>
            <input type="number" min={0} value={restingHeartRate || ""} onChange={(event) => setRestingHeartRate(Number(event.target.value))} />
          </label>
          <button className="primary-button field-wide" type="submit">
            <HeartPulse size={18} />
            Health Daten speichern
          </button>
        </form>
      </section>

      <section className="panel">
        <SectionHeader title="Heute relevant" />
        <div className="list">
          <InfoRow
            icon={<Home size={17} />}
            title={homeToday?.isHome ? "Zuhause eingeplant" : "Kein Zuhause-Tag gesetzt"}
            detail={homeToday?.plannedMeals?.join(", ") || "Gemini kann Mahlzeiten nur fuer markierte Tage planen."}
          />
          <InfoRow
            icon={<Flame size={17} />}
            title="Mikro-Watchlist"
            detail="Ballaststoffe, Omega 3, Vitamin D, Magnesium, Kalium, Calcium, Jod, Eisen."
          />
        </div>
      </section>
    </div>
  );
}

function FoodScreen({
  data,
  foodReferences,
  today,
  settings,
  usingCloud,
  onSaveMeal,
  onRemoveMeal,
  onSaveFoodReference,
  onSettings,
  onNotice,
}: {
  data: AppData;
  foodReferences: FoodReference[];
  today: string;
  settings: AutomationSettings;
  usingCloud: boolean;
  onSaveMeal: (item: MealEntry & Saveable) => Promise<void>;
  onRemoveMeal: (id: string) => Promise<void>;
  onSaveFoodReference: (item: FoodReference & Saveable) => Promise<void>;
  onSettings: (settings: AutomationSettings) => Promise<void>;
  onNotice: (notice: Notice) => void;
}) {
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [date, setDate] = useState(today);
  const [foodQuery, setFoodQuery] = useState("");
  const [grams, setGrams] = useState(100);
  const [freeText, setFreeText] = useState("");
  const [barcode, setBarcode] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mealsToday = data.mealEntries.filter((meal) => meal.date === date);
  const selectedFood = findFoodReference(foodReferences, foodQuery);

  async function saveItems(items: MealItem[], description?: string, photo?: DrivePhotoUploadResult) {
    const nutrition = items.reduce<Nutrients>(
      (sum, item) => mergeNutrients(sum, item.nutrients ?? zeroNutrients()),
      zeroNutrients(),
    );
    const hasNutrition = hasMeaningfulNutrition(nutrition);
    const needsResearch =
      !hasNutrition ||
      items.some((item) => item.confidence === "needs-gemini" || item.source === "seed-estimate");
    await onSaveMeal({
      id: `meal-${date}-${Date.now()}`,
      date,
      capturedAt: nowIso(),
      mealType,
      mode: photo ? "photo" : items.length ? "weighed" : "freeText",
      description: description || items.map((item) => item.name).join(", ") || freeText || "Meal",
      items,
      total: hasNutrition ? nutrition : undefined,
      nutritionEstimate: hasNutrition ? nutrition : undefined,
      confidence: needsResearch ? "needs-gemini" : items.every((item) => item.confidence === "high") ? "high" : "medium",
      geminiResearch: needsResearch
        ? {
            status: "queued",
            requestedAt: nowIso(),
            notes: hasNutrition
              ? "Vorlaeufige Seed-/Produktwerte vorhanden. Gemini soll saubere Naehrwerte mit Quellen recherchieren."
              : "Keine generischen Naehrwerte eingetragen. Gemini soll sauber recherchieren.",
          }
        : {
            status: "applied",
            updatedAt: nowIso(),
            notes: "Produktdaten mit hoher Sicherheit uebernommen.",
          },
      photo,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    setFoodQuery("");
    setFreeText("");
  }

  async function addWeightedFood() {
    const food = selectedFood ?? findFoodReference(foodReferences, foodQuery);
    if (!food) {
      await saveItems([], freeText || foodQuery || "Unbekanntes Essen");
      onNotice({ tone: "warn", text: "Essen wurde als Gemini-Recherche gespeichert, ohne generische Naehrwerte." });
      return;
    }

    await saveItems([
      {
        id: `item-${Date.now()}`,
        foodRefId: food.id,
        name: food.name,
        grams,
        nutrients: scaledNutrients(food, grams),
        source: food.source,
        confidence: food.source === "open-food-facts" ? "high" : food.source === "seed-estimate" ? "needs-gemini" : "medium",
      },
    ]);
  }

  async function addTemplate(templateId: string) {
    const template = mealTemplates.find((item) => item.id === templateId);
    if (!template) return;

    const items = template.items
      .map((item) => {
        const food = foodReferences.find((reference) => reference.id === item.foodRefId);
        if (!food) return undefined;
        return {
          id: `item-${Date.now()}-${item.foodRefId}`,
          foodRefId: food.id,
          name: food.name,
          grams: item.grams,
          nutrients: scaledNutrients(food, item.grams),
          source: food.source,
          confidence: food.source === "open-food-facts" ? "high" : food.source === "seed-estimate" ? "needs-gemini" : "medium",
        } satisfies MealItem;
      })
      .filter(Boolean) as MealItem[];

    await saveItems(items, template.label);
  }

  async function handleBarcodeLookup() {
    if (!barcode.trim()) return;
    setLookupBusy(true);
    try {
      const product = await lookupBarcode(barcode.trim());
      if (!product) {
        onNotice({ tone: "warn", text: "Produkt wurde nicht gefunden." });
        return;
      }
      await onSaveFoodReference(product as FoodReference & Saveable);
      setFoodQuery(product.name);
      onNotice({ tone: "good", text: "Produktdaten wurden gespeichert." });
    } finally {
      setLookupBusy(false);
    }
  }

  async function handlePhotoUpload(file: File) {
    setPhotoBusy(true);
    try {
      const prepared = await prepareMealPhoto(file);
      let photo: DrivePhotoUploadResult | undefined;

      if (usingCloud && hasGoogleOAuthClient()) {
        const client = createDrivePhotoClient({
          clientId: googleOAuthClientId(),
          folderId: settings.googleDriveFolderId,
        });
        photo = await client.uploadMealPhoto(prepared.file, prepared.thumbnail);
        if (!settings.googleDriveFolderId && photo.folderId) {
          await onSettings({ ...settings, googleDriveFolderId: photo.folderId });
        }
      } else {
        photo = {
          driveFileId: `local-${Date.now()}`,
          thumbnail: prepared.thumbnail,
          webViewLink: prepared.thumbnail,
        };
      }

      await saveItems([], freeText || "Meal photo", photo);
      onNotice({ tone: "good", text: "Foto wurde mit dem Essen gespeichert." });
    } catch (error) {
      onNotice({
        tone: "warn",
        text: error instanceof Error ? error.message : "Foto konnte nicht gespeichert werden.",
      });
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="screen stack">
      <section className="screen-title">
        <div>
          <small>Food Log</small>
          <h1>Essen schnell erfassen</h1>
        </div>
        <Pill tone="info">{sumCalories(data.mealEntries, date)} kcal</Pill>
      </section>

      <section className="panel">
        <div className="segmented">
          {mealTypes.map((type) => (
            <button
              key={type}
              className={classNames(type === mealType && "active")}
              onClick={() => setMealType(type)}
            >
              {mealLabels[type]}
            </button>
          ))}
        </div>

        <div className="form-grid compact">
          <label className="field">
            <span>Datum</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Gramm</span>
            <input
              type="number"
              min={1}
              value={grams}
              onChange={(event) => setGrams(Number(event.target.value))}
            />
          </label>
          <label className="field field-wide">
            <span>Essen</span>
            <input
              list="foods"
              value={foodQuery}
              onChange={(event) => setFoodQuery(event.target.value)}
              placeholder="z.B. Steak, Kartoffeln, Doener"
            />
            <datalist id="foods">
              {foodReferences.map((food) => (
                <option key={food.id} value={food.name} />
              ))}
            </datalist>
          </label>
          <button className="primary-button field-wide" type="button" onClick={addWeightedFood}>
            <Salad size={18} />
            Eintrag speichern
          </button>
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Templates" />
        <div className="template-grid">
          {mealTemplates.map((template) => (
            <button key={template.id} onClick={() => addTemplate(template.id)}>
              <strong>{template.label}</strong>
              <small>{template.items.length} Items</small>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Produkt & Foto" />
        <div className="form-grid compact">
          <label className="field field-wide">
            <span>Barcode</span>
            <div className="inline-control">
              <input value={barcode} onChange={(event) => setBarcode(event.target.value)} />
              <button type="button" onClick={handleBarcodeLookup} disabled={lookupBusy}>
                {lookupBusy ? <Loader2 size={17} className="spin" /> : <Search size={17} />}
              </button>
            </div>
          </label>
          <label className="field field-wide">
            <span>Freitext</span>
            <textarea
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
              rows={3}
              placeholder="z.B. Doener mit extra Fleisch, wenig Sauce"
            />
          </label>
          <input
            ref={fileInput}
            className="hidden-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handlePhotoUpload(file);
            }}
          />
          <button
            className="secondary-button field-wide"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={photoBusy}
          >
            {photoBusy ? <Loader2 size={18} className="spin" /> : <Camera size={18} />}
            Foto speichern
          </button>
        </div>
      </section>

      <section className="panel">
        <SectionHeader title={date === today ? "Heute" : displayDate(date)} />
        <MealList meals={mealsToday} onRemove={onRemoveMeal} />
      </section>
    </div>
  );
}

function ShoppingScreen({
  data,
  today,
  onSave,
  onRemove,
}: {
  data: AppData;
  today: string;
  onSave: (item: ShoppingListItem & Saveable) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const openItems = data.shoppingList
    .filter((item) => item.status === "open")
    .slice()
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const checkedItems = data.shoppingList
    .filter((item) => item.status === "checked")
    .slice()
    .sort((a, b) => (b.checkedAt ?? b.updatedAt ?? "").localeCompare(a.checkedAt ?? a.updatedAt ?? ""))
    .slice(0, 8);
  const existing = new Set(data.shoppingList.filter((item) => item.status === "open").map((item) => normalizeShoppingTitle(item.title)));
  const suggestions = buildShoppingItems(data, today).filter((item) => !existing.has(normalizeShoppingTitle(item)));

  async function addManual(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await onSave(createShoppingListItem({ title, quantity, source: "manual" }) as ShoppingListItem & Saveable);
    setTitle("");
    setQuantity("");
  }

  async function addSuggestion(item: string) {
    await onSave(createShoppingListItem({ title: item, source: "suggested", reason: "Aus Zuhause-Tagen und geplanten Mahlzeiten vorgeschlagen." }) as ShoppingListItem & Saveable);
  }

  async function addAllSuggestions() {
    for (const item of suggestions) {
      await addSuggestion(item);
    }
  }

  function startEdit(item: ShoppingListItem) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditQuantity(item.quantity ?? "");
  }

  async function saveEdit(item: ShoppingListItem) {
    if (!editTitle.trim()) return;
    await onSave({
      ...item,
      title: editTitle.trim(),
      quantity: editQuantity.trim() || undefined,
      updatedAt: nowIso(),
    });
    setEditingId("");
  }

  async function toggleChecked(item: ShoppingListItem) {
    await onSave({
      ...item,
      status: item.status === "open" ? "checked" : "open",
      checkedAt: item.status === "open" ? nowIso() : undefined,
      updatedAt: nowIso(),
    });
  }

  return (
    <div className="screen stack">
      <section className="screen-title">
        <div>
          <small>{SHOPPING_LIST_TITLE}</small>
          <h1>Einkaufsliste</h1>
        </div>
        <Pill tone={openItems.length ? "warn" : "good"}>{openItems.length} offen</Pill>
      </section>

      <section className="shopping-hero">
        <div>
          <small>Planung</small>
          <strong>{suggestions.length ? `${suggestions.length} Vorschlaege aus der App` : "Alles Wichtige ist auf der Liste"}</strong>
          <span>Zuhause-Tage, Standardmahlzeiten und Gemini-Vorschlaege landen direkt hier.</span>
        </div>
        <button className="primary-button" type="button" onClick={addAllSuggestions} disabled={suggestions.length === 0}>
          <Plus size={18} />
          Alle uebernehmen
        </button>
      </section>

      <section className="panel">
        <SectionHeader title="Selbst hinzufuegen" />
        <form className="form-grid compact" onSubmit={addManual}>
          <label className="field">
            <span>Item</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="z.B. Eier" />
          </label>
          <label className="field">
            <span>Menge</span>
            <input value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="z.B. 10 Stueck" />
          </label>
          <button className="primary-button field-wide" type="submit">
            <Plus size={18} />
            Zur Liste
          </button>
        </form>
      </section>

      <section className="panel">
        <SectionHeader title="Vorschlaege" />
        <div className="shopping-list-preview">
          {suggestions.length === 0 && <EmptyLine text="Keine neuen Vorschlaege." />}
          {suggestions.slice(0, 16).map((item) => (
            <button key={item} type="button" onClick={() => addSuggestion(item)}>
              <Plus size={14} />
              {item}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Offen" />
        <div className="shopping-list">
          {openItems.length === 0 && <EmptyLine text="Liste ist leer." />}
          {openItems.map((item) => (
            <article key={item.id} className={classNames("shopping-item", `priority-${item.priority}`)}>
              <button className="icon-button" type="button" title="Erledigt" aria-label="Erledigt" onClick={() => toggleChecked(item)}>
                <CheckCircle2 size={18} />
              </button>
              {editingId === item.id ? (
                <div className="shopping-edit">
                  <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                  <input value={editQuantity} onChange={(event) => setEditQuantity(event.target.value)} placeholder="Menge" />
                </div>
              ) : (
                <div>
                  <strong>{item.quantity ? `${item.quantity} ${item.title}` : item.title}</strong>
                  <small>{[item.source, item.reason].filter(Boolean).join(" - ")}</small>
                </div>
              )}
              <div className="row-actions">
                {editingId === item.id ? (
                  <button className="icon-button" type="button" title="Speichern" aria-label="Speichern" onClick={() => saveEdit(item)}>
                    <ShieldCheck size={17} />
                  </button>
                ) : (
                  <button className="icon-button" type="button" title="Bearbeiten" aria-label="Bearbeiten" onClick={() => startEdit(item)}>
                    <Edit3 size={17} />
                  </button>
                )}
                <button className="icon-button danger-icon" type="button" title="Loeschen" aria-label="Loeschen" onClick={() => onRemove(item.id)}>
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Erledigt" />
        <div className="shopping-list compact-list">
          {checkedItems.length === 0 && <EmptyLine text="Noch nichts abgehakt." />}
          {checkedItems.map((item) => (
            <article key={item.id} className="shopping-item checked">
              <button className="icon-button" type="button" title="Wieder oeffnen" aria-label="Wieder oeffnen" onClick={() => toggleChecked(item)}>
                <RefreshCw size={17} />
              </button>
              <div>
                <strong>{item.quantity ? `${item.quantity} ${item.title}` : item.title}</strong>
                <small>{item.checkedAt ? `erledigt ${formatTime(item.checkedAt)}` : item.source}</small>
              </div>
              <button className="icon-button danger-icon" type="button" title="Loeschen" aria-label="Loeschen" onClick={() => onRemove(item.id)}>
                <Trash2 size={17} />
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function BodyScreen({
  today,
  bodyStatus,
  trainingSessions,
  recommendation,
  onSave,
}: {
  today: string;
  bodyStatus?: BodyStatus;
  trainingSessions: TrainingSession[];
  recommendation: ReturnType<typeof recommendGymDay>;
  onSave: (item: BodyStatus & Saveable) => Promise<void>;
}) {
  const [selected, setSelected] = useState(bodyMuscleGroups[0].id);
  const [muscleStatus, setMuscleStatus] = useState(
    () => bodyStatus?.muscles ?? Object.fromEntries(bodyMuscleGroups.map((group) => [group.id, { soreness: 0, pain: 0 }])),
  );
  const selectedStatus = muscleStatus[selected] ?? { soreness: 0, pain: 0 };
  const bodyLoad = averageBodyLoad(bodyStatus);
  const recentSessions = trainingSessions.slice().sort(sortByDateDesc).slice(0, 4);

  useEffect(() => {
    if (bodyStatus?.muscles) setMuscleStatus(bodyStatus.muscles);
  }, [bodyStatus?.id]);

  async function saveStatus() {
    await onSave({
      id: today,
      date: today,
      muscles: muscleStatus,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  function updateSelected(key: "soreness" | "pain", value: number) {
    setMuscleStatus((previous) => ({
      ...previous,
      [selected]: {
        soreness: previous[selected]?.soreness ?? 0,
        pain: previous[selected]?.pain ?? 0,
        [key]: value,
      },
    }));
  }

  return (
    <div className="screen stack">
      <section className="screen-title">
        <div>
          <small>Body Map</small>
          <h1>Schmerz & Muskelkater</h1>
        </div>
        <Pill tone={bodyLoad > 5 ? "warn" : "good"}>{round(bodyLoad, 1)}/10 Load</Pill>
      </section>

      <section className="body-layout">
        <BodyMap selected={selected} status={muscleStatus} onSelect={setSelected} />
        <div className="panel body-control">
          <SectionHeader title={bodyMuscleGroups.find((group) => group.id === selected)?.label ?? selected} />
          <SliderField
            label="Muskelkater"
            value={selectedStatus.soreness}
            min={0}
            max={10}
            onChange={(value) => updateSelected("soreness", value)}
          />
          <SliderField
            label="Schmerz"
            value={selectedStatus.pain}
            min={0}
            max={10}
            onChange={(value) => updateSelected("pain", value)}
          />
          <button className="primary-button" onClick={saveStatus}>
            <ShieldCheck size={18} />
            Body Check speichern
          </button>
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Gym-Vorschlag" />
        <div className="recommendation">
          <div>
            <strong>{recommendation.planName}</strong>
            <p>{recommendation.reason}</p>
          </div>
          <Pill tone={recommendation.recoveryNeeded ? "warn" : "good"}>
            {recommendation.recoveryNeeded ? "Recovery" : "Trainierbar"}
          </Pill>
        </div>
        <div className="chip-row">
          {recommendation.muscleGroups.map((muscle) => (
            <span key={muscle}>{bodyMuscleGroups.find((group) => group.id === muscle)?.label ?? muscle}</span>
          ))}
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Letzte Trainings" />
        <div className="list">
          {recentSessions.length === 0 && <EmptyLine text="Noch kein Training geloggt." />}
          {recentSessions.map((session) => (
            <InfoRow
              key={session.id}
              icon={<Dumbbell size={17} />}
              title={`${displayDate(session.date)} - ${session.planName}`}
              detail={`Intensitaet ${session.intensity}/10 - ${session.muscleGroups.length} Muskelgruppen`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function BodyMap({
  selected,
  status,
  onSelect,
}: {
  selected: string;
  status: BodyStatus["muscles"];
  onSelect: (muscle: string) => void;
}) {
  return (
    <section className="body-map-panel">
      <svg viewBox="0 0 280 520" role="img" aria-label="Koerpermodell">
        <BodyRegion id="shoulders" label="Schultern" selected={selected} status={status} onSelect={onSelect} d="M76 120 C96 95 184 95 204 120 L190 158 C166 145 114 145 90 158 Z" />
        <BodyRegion id="chest" label="Brust" selected={selected} status={status} onSelect={onSelect} d="M92 158 C111 145 169 145 188 158 L178 228 C154 218 126 218 102 228 Z" />
        <BodyRegion id="core" label="Core" selected={selected} status={status} onSelect={onSelect} d="M104 226 C126 218 154 218 176 226 L166 306 C150 316 130 316 114 306 Z" />
        <BodyRegion id="arms" label="Arme" selected={selected} status={status} onSelect={onSelect} d="M60 150 L90 160 L78 290 L48 286 Z M190 160 L220 150 L232 286 L202 290 Z" />
        <BodyRegion id="back" label="Ruecken" selected={selected} status={status} onSelect={onSelect} d="M96 112 C124 88 156 88 184 112 L190 214 C160 198 120 198 90 214 Z" transform="translate(0 0)" />
        <BodyRegion id="glutes" label="Gesaess" selected={selected} status={status} onSelect={onSelect} d="M108 304 C126 318 154 318 172 304 L184 356 C164 374 116 374 96 356 Z" />
        <BodyRegion id="quads" label="Quads" selected={selected} status={status} onSelect={onSelect} d="M98 356 L134 356 L126 474 L90 474 Z M146 356 L182 356 L190 474 L154 474 Z" />
        <BodyRegion id="hamstrings" label="Hamstrings" selected={selected} status={status} onSelect={onSelect} d="M92 356 C108 378 124 410 126 474 L90 474 C80 418 78 388 92 356 Z M188 356 C172 378 156 410 154 474 L190 474 C200 418 202 388 188 356 Z" opacity="0.78" />
        <BodyRegion id="calves" label="Waden" selected={selected} status={status} onSelect={onSelect} d="M90 472 L126 472 L118 510 L94 510 Z M154 472 L190 472 L186 510 L162 510 Z" />
        <circle cx="140" cy="62" r="34" className="body-head" />
      </svg>
      <div className="body-legend">
        <span><i className="legend low" /> leicht</span>
        <span><i className="legend mid" /> mittel</span>
        <span><i className="legend high" /> hoch</span>
      </div>
    </section>
  );
}

function BodyRegion({
  id,
  label,
  selected,
  status,
  onSelect,
  d,
  opacity,
  transform,
}: {
  id: string;
  label: string;
  selected: string;
  status: BodyStatus["muscles"];
  onSelect: (muscle: string) => void;
  d: string;
  opacity?: string;
  transform?: string;
}) {
  const load = Math.max(status[id]?.soreness ?? 0, status[id]?.pain ?? 0);
  return (
    <path
      d={d}
      transform={transform}
      opacity={opacity}
      className={classNames("body-region", mapLoadColor(load), selected === id && "selected")}
      onClick={() => onSelect(id)}
      tabIndex={0}
      role="button"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(id);
      }}
    />
  );
}

function TrainingScreen({
  today,
  sessions,
  recommendation,
  onSave,
  onRemove,
}: {
  today: string;
  sessions: TrainingSession[];
  recommendation: ReturnType<typeof recommendGymDay>;
  onSave: (item: TrainingSession & Saveable) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [date, setDate] = useState(today);
  const [planName, setPlanName] = useState(recommendation.planName);
  const [intensity, setIntensity] = useState(6);
  const [selectedMuscles, setSelectedMuscles] = useState<string[]>(recommendation.muscleGroups);
  const [notes, setNotes] = useState("");
  const sortedSessions = sessions.slice().sort(sortByDateDesc).slice(0, 12);

  useEffect(() => {
    setPlanName(recommendation.planName);
    setSelectedMuscles(recommendation.muscleGroups);
  }, [recommendation.planName]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({
      id: `training-${date}-${Date.now()}`,
      date,
      planName,
      muscleGroups: selectedMuscles,
      intensity,
      notes,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    setNotes("");
  }

  function toggleMuscle(id: string) {
    setSelectedMuscles((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  }

  return (
    <div className="screen stack">
      <section className="screen-title">
        <div>
          <small>Training</small>
          <h1>{recommendation.planName}</h1>
        </div>
        <Pill tone={recommendation.recoveryNeeded ? "warn" : "good"}>{recommendation.reason}</Pill>
      </section>

      <section className="panel">
        <form className="form-grid" onSubmit={submit}>
          <label className="field">
            <span>Datum</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Plan</span>
            <select value={planName} onChange={(event) => setPlanName(event.target.value)}>
              {[recommendation.planName, ...trainingPlans.map((plan) => plan.name)]
                .filter((value, index, array) => array.indexOf(value) === index)
                .map((name) => (
                  <option key={name}>{name}</option>
                ))}
            </select>
          </label>
          <SliderField label="Intensitaet" value={intensity} min={1} max={10} onChange={setIntensity} />
          <div className="field field-wide">
            <span>Muskelgruppen</span>
            <div className="chip-grid">
              {bodyMuscleGroups.map((group) => (
                <button
                  type="button"
                  key={group.id}
                  className={classNames(selectedMuscles.includes(group.id) && "active")}
                  onClick={() => toggleMuscle(group.id)}
                >
                  {group.label}
                </button>
              ))}
            </div>
          </div>
          <label className="field field-wide">
            <span>Notiz</span>
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <button className="primary-button field-wide" type="submit">
            <Dumbbell size={18} />
            Training speichern
          </button>
        </form>
      </section>

      <section className="panel">
        <SectionHeader title="Trainingslog" />
        <div className="list">
          {sortedSessions.length === 0 && <EmptyLine text="Noch kein Training gespeichert." />}
          {sortedSessions.map((session) => (
            <InfoRow
              key={session.id}
              icon={<Dumbbell size={17} />}
              title={`${displayDate(session.date)} - ${session.planName}`}
              detail={`Intensitaet ${session.intensity}/10 - ${session.muscleGroups.map((id) => bodyMuscleGroups.find((group) => group.id === id)?.label ?? id).join(", ")}`}
              action={
                <button className="text-button" onClick={() => onRemove(session.id)}>
                  Entfernen
                </button>
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SupplementsScreen({
  today,
  logs,
  onSave,
  onRemove,
}: {
  today: string;
  logs: SupplementLog[];
  onSave: (item: SupplementLog & Saveable) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [date, setDate] = useState(today);
  const [name, setName] = useState(supplementOptions[0]);
  const [dose, setDose] = useState("");
  const [notes, setNotes] = useState("");
  const sortedLogs = logs.slice().sort(sortByDateDesc).slice(0, 20);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({
      id: `supp-${date}-${Date.now()}`,
      date,
      name,
      dose,
      notes,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    setDose("");
    setNotes("");
  }

  return (
    <div className="screen stack">
      <section className="screen-title">
        <div>
          <small>Supplements</small>
          <h1>Konstanz tracken</h1>
        </div>
      </section>

      <section className="panel">
        <form className="form-grid" onSubmit={submit}>
          <label className="field">
            <span>Datum</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Supplement</span>
            <input list="supplements" value={name} onChange={(event) => setName(event.target.value)} />
            <datalist id="supplements">
              {supplementOptions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Dosis</span>
            <input value={dose} onChange={(event) => setDose(event.target.value)} placeholder="z.B. 400 mg" />
          </label>
          <label className="field field-wide">
            <span>Notiz</span>
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <button className="primary-button field-wide" type="submit">
            <Activity size={18} />
            Einnahme speichern
          </button>
        </form>
      </section>

      <section className="panel">
        <SectionHeader title="Log" />
        <div className="list">
          {sortedLogs.length === 0 && <EmptyLine text="Noch keine Supplements gespeichert." />}
          {sortedLogs.map((log) => (
            <InfoRow
              key={log.id}
              icon={<Activity size={17} />}
              title={`${displayDate(log.date)} - ${log.name}`}
              detail={[log.dose, log.notes].filter(Boolean).join(" - ")}
              action={
                <button className="text-button" onClick={() => onRemove(log.id)}>
                  Entfernen
                </button>
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function HomeDaysScreen({
  today,
  homeDays,
  meals,
  onSave,
}: {
  today: string;
  homeDays: HomeDay[];
  meals: MealEntry[];
  onSave: (item: HomeDay & Saveable) => Promise<void>;
}) {
  const days = Array.from({ length: 14 }, (_, index) => addDays(today, index));

  async function toggleDay(date: string, isHome: boolean) {
    const existing = homeDays.find((day) => day.date === date);
    await onSave({
      id: date,
      date,
      isHome,
      plannedMeals: existing?.plannedMeals ?? (isHome ? ["lunch", "dinner"] : []),
      notes: existing?.notes ?? "",
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    });
  }

  async function updateMeals(date: string, mealType: MealType) {
    const existing = homeDays.find((day) => day.date === date);
    const plannedMeals = existing?.plannedMeals ?? [];
    const nextMeals = plannedMeals.includes(mealType)
      ? plannedMeals.filter((meal) => meal !== mealType)
      : [...plannedMeals, mealType];
    await onSave({
      id: date,
      date,
      isHome: existing?.isHome ?? true,
      plannedMeals: nextMeals,
      notes: existing?.notes ?? "",
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    });
  }

  return (
    <div className="screen stack">
      <section className="screen-title">
        <div>
          <small>Meal Planning</small>
          <h1>Zuhause-Tage</h1>
        </div>
      </section>

      <section className="panel day-list">
        {days.map((date) => {
          const day = homeDays.find((item) => item.date === date);
          const calories = sumCalories(meals, date);
          return (
            <div key={date} className={classNames("day-row", day?.isHome && "active")}>
              <button onClick={() => toggleDay(date, !(day?.isHome ?? false))}>
                <strong>{displayDate(date)}</strong>
                <small>{day?.isHome ? "Zuhause" : "Auswaerts"} - {calories} kcal geloggt</small>
              </button>
              <div className="meal-toggles">
                {(["lunch", "dinner"] as MealType[]).map((mealType) => (
                  <button
                    key={mealType}
                    className={classNames(day?.plannedMeals?.includes(mealType) && "active")}
                    onClick={() => updateMeals(date, mealType)}
                  >
                    {mealLabels[mealType]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function AutomationScreen({
  user,
  data,
  settings,
  usingCloud,
  recovery,
  gymRecommendation,
  onSettings,
  onSaveMeal,
  onSaveShoppingItem,
  onNotice,
}: {
  user: User | null;
  data: AppData;
  settings: AutomationSettings;
  usingCloud: boolean;
  recovery: ReturnType<typeof calculateRecoveryScore>;
  gymRecommendation: ReturnType<typeof recommendGymDay>;
  onSettings: (settings: AutomationSettings) => Promise<void>;
  onSaveMeal: (item: MealEntry & Saveable) => Promise<void>;
  onSaveShoppingItem: (item: ShoppingListItem & Saveable) => Promise<void>;
  onNotice: (notice: Notice) => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [manualRunBusy, setManualRunBusy] = useState(false);
  const [researchBusy, setResearchBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [recentRuns, setRecentRuns] = useState<GeminiRun[]>([]);
  const shoppingItems = useMemo(() => buildShoppingItems(data), [data]);
  const nutritionResearchQueue = useMemo(() => buildNutritionResearchQueue(data), [data]);
  const openShoppingTitles = useMemo(
    () => new Set(data.shoppingList.filter((item) => item.status === "open").map((item) => normalizeShoppingTitle(item.title))),
    [data.shoppingList],
  );
  const pendingShoppingActions = useMemo(
    () =>
      recentRuns
        .flatMap((run) => parseGeminiTaskActions(run.taskActions).map((action) => ({ ...action, runId: run.id })))
        .filter((action) => isShoppingAddAction(action) && !openShoppingTitles.has(normalizeShoppingTitle(action.item)))
        .slice(0, 20),
    [recentRuns, openShoppingTitles],
  );
  const latestRun = recentRuns[0];
  const nextGeminiRunAt = nextFullHour();
  const lastPublishedSnapshotRef = useRef("");
  const shortcutBaseUrl = useMemo(() => buildHealthShortcutUrl(settings.shortcutToken), [settings.shortcutToken]);
  const shortcutJsonExampleUrl = useMemo(
    () =>
      buildHealthShortcutUrl(settings.shortcutToken, {
        date: todayKey(),
        sleepHours: 7.4,
        steps: 8200,
        restingHeartRate: 58,
        weightKg: 80.2,
        bodyFatPct: 14.1,
      }),
    [settings.shortcutToken],
  );

  async function copyText(value: string) {
    await navigator.clipboard?.writeText(value);
    onNotice({ tone: "good", text: "In die Zwischenablage kopiert." });
  }

  async function rotateShortcutToken() {
    await onSettings({ ...settings, shortcutToken: createToken("shortcut") });
  }

  async function publishSnapshot({ silent = false }: { silent?: boolean } = {}) {
    if (!usingCloud || !db || !user) {
      if (!silent) {
        onNotice({ tone: "warn", text: "Gemini-Snapshot braucht Firebase Login." });
      }
      return;
    }

    setPublishing(true);
    try {
      const snapshot = buildGeminiSnapshot({
        ownerUid: user.uid,
        settings,
        data,
        recovery,
        gymRecommendation,
      });
      await setDoc(doc(db, "users", user.uid, "geminiSnapshots", "latest"), snapshot);
      if (!silent) {
        onNotice({ tone: "good", text: "Snapshot aktualisiert." });
      }
    } finally {
      setPublishing(false);
    }
  }

  useEffect(() => {
    if (!usingCloud || !db || !user) return;

    const publishKey = JSON.stringify({
      ownerUid: user.uid,
      dailyLogs: data.dailyLogs.length,
      healthImports: data.healthImports.length,
      mealEntries: data.mealEntries.length,
      supplements: data.supplements.length,
      trainingSessions: data.trainingSessions.length,
      homeDays: data.homeDays.length,
      bodyStatuses: data.bodyStatuses.length,
      shoppingList: data.shoppingList.length,
      recoveryScore: recovery.score,
      gymPlan: gymRecommendation.planName,
      updatedAt: nowIso().slice(0, 13),
    });

    if (lastPublishedSnapshotRef.current === publishKey) return;
    lastPublishedSnapshotRef.current = publishKey;

    publishSnapshot({ silent: true }).catch(() => {
      lastPublishedSnapshotRef.current = "";
    });
  }, [
    usingCloud,
    user,
    data,
    recovery.score,
    gymRecommendation.planName,
  ]);

  useEffect(() => {
    if (!usingCloud || !db || !user) {
      setRecentRuns([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "users", user.uid, "geminiRuns"), orderBy("createdAt", "desc"), limit(8)),
      (items) => {
        setRecentRuns(items.docs.map((item) => normalizeFirestore<GeminiRun>({ id: item.id, ...item.data() })));
      },
      () => undefined,
    );
  }, [usingCloud, user]);

  async function runGeminiNow() {
    if (!usingCloud || !db || !user || !app) {
      onNotice({ tone: "warn", text: "Gemini-Lauf braucht Firebase Login." });
      return;
    }

    setManualRunBusy(true);
    try {
      await publishSnapshot({ silent: true });
      const functionsClient = getFunctions(app, GEMINI_FUNCTIONS_REGION);
      const trigger = httpsCallable(functionsClient, "runGeminiAnalysis");
      const result = await trigger();
      const payload = result.data as { status?: string; mode?: string };

      if (payload.status === "written") {
        onNotice({
          tone: "good",
          text: payload.mode ? `Gemini-Lauf gespeichert (${payload.mode}).` : "Gemini-Lauf gespeichert.",
        });
        return;
      }

      if (payload.status === "deduped") {
        onNotice({ tone: "info", text: "In dieser Stunde existiert bereits ein passender No-Op-Lauf." });
        return;
      }

      if (payload.status === "no_snapshot") {
        onNotice({ tone: "warn", text: "Kein Snapshot vorhanden. Bitte zuerst Snapshot aktualisieren." });
        return;
      }

      onNotice({ tone: "warn", text: "Gemini-Lauf lieferte kein verwertbares Ergebnis." });
    } catch (error) {
      onNotice({
        tone: "warn",
        text: error instanceof Error ? error.message : "Gemini-Lauf ist fehlgeschlagen.",
      });
    } finally {
      setManualRunBusy(false);
    }
  }

  async function applyGeminiShoppingActions() {
    setTaskBusy(true);
    try {
      let applied = 0;
      for (const action of pendingShoppingActions) {
        await onSaveShoppingItem(
          createShoppingListItem({
            title: action.item,
            reason: action.reason,
            priority: action.priority,
            source: "gemini",
            geminiRunId: action.runId,
          }) as ShoppingListItem & Saveable,
        );
        applied += 1;
      }
      onNotice({
        tone: applied ? "good" : "info",
        text: applied ? `${applied} Gemini-Vorschlaege in die Einkaufsliste uebernommen.` : "Keine neuen Gemini-Items offen.",
      });
    } finally {
      setTaskBusy(false);
    }
  }

  async function applyGeminiNutritionUpdates() {
    if (!usingCloud || !db || !user) {
      onNotice({ tone: "warn", text: "Naehrwert-Updates brauchen Firebase Login." });
      return;
    }

    setResearchBusy(true);
    try {
      const updates = recentRuns.flatMap(extractNutritionUpdates);
      const mealsById = new Map(data.mealEntries.map((meal) => [meal.id, meal]));
      let applied = 0;

      for (const update of updates) {
        const meal = mealsById.get(update.mealId);
        if (!meal || meal.confidence !== "needs-gemini") continue;
        await onSaveMeal({
          ...meal,
          total: update.nutrients,
          nutritionEstimate: update.nutrients,
          confidence: update.confidence,
          notes: [meal.notes, update.assumptions].filter(Boolean).join("\n"),
          geminiResearch: {
            status: "applied",
            requestedAt: meal.geminiResearch?.requestedAt,
            updatedAt: nowIso(),
            sources: update.sources,
            notes: update.assumptions,
          },
          updatedAt: nowIso(),
        });
        mealsById.set(update.mealId, { ...meal, confidence: update.confidence });
        applied += 1;
      }

      onNotice({
        tone: applied ? "good" : "info",
        text: applied ? `${applied} recherchierte Mahlzeiten uebernommen.` : "Keine neuen sicheren Naehrwert-Updates gefunden.",
      });
    } catch (error) {
      onNotice({
        tone: "warn",
        text: error instanceof Error ? error.message : "Gemini-Naehrwerte konnten nicht uebernommen werden.",
      });
    } finally {
      setResearchBusy(false);
    }
  }

  return (
    <div className="screen stack">
      <section className="screen-title">
        <div>
          <small>Gemini</small>
          <h1>KI-Auswertung</h1>
        </div>
        <Pill tone={usingCloud ? "good" : "warn"}>{usingCloud ? `naechster Lauf ${formatTime(nextGeminiRunAt)}` : "Login offen"}</Pill>
      </section>

      <section className="panel">
        <SectionHeader
          title="Gemini Snapshot"
          action={<Pill tone={nutritionResearchQueue.length ? "warn" : "good"}>{nutritionResearchQueue.length} Research offen</Pill>}
        />
        <div className="button-row">
          <button className="primary-button" onClick={() => publishSnapshot()} disabled={publishing}>
            {publishing ? <Loader2 size={18} className="spin" /> : <UploadCloud size={18} />}
            Snapshot aktualisieren
          </button>
          <button className="secondary-button" onClick={runGeminiNow} disabled={manualRunBusy}>
            {manualRunBusy ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
            Jetzt ausfuehren
          </button>
          <button className="secondary-button" onClick={applyGeminiNutritionUpdates} disabled={researchBusy}>
            {researchBusy ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
            Naehrwerte uebernehmen
          </button>
        </div>
      </section>

      <section className="panel integration-panel">
        <SectionHeader
          title="Gemini Wirkung"
          action={<Pill tone={latestRun ? "good" : "warn"}>{latestRun ? `letzter Lauf ${formatTime(latestRun.createdAt)}` : "kein Lauf"}</Pill>}
        />
        <p className="panel-copy">
          Gemini schreibt strukturierte Vorschlaege direkt in Firestore. Einkaufsideen und Naehrwert-Recherchen bleiben in der App, ohne externe Task-Liste.
        </p>
        {latestRun ? (
          <div className="gemini-run-card">
            <strong>{latestRun.summary || "Gemini-Lauf ohne Summary"}</strong>
            <small>{latestRun.nextPriorities?.slice(0, 3).join(" - ") || "Keine naechsten Prioritaeten gespeichert."}</small>
          </div>
        ) : (
          <EmptyLine text="Noch kein Gemini-Lauf gespeichert." />
        )}
        <div className="shopping-list-preview">
          {pendingShoppingActions.length === 0 && shoppingItems.slice(0, 8).map((item) => <span key={item}>{item}</span>)}
          {pendingShoppingActions.map((action) => (
            <span key={`${action.runId}-${action.item}`}>{action.item}</span>
          ))}
        </div>
        <div className="button-row">
          <button className="primary-button" onClick={applyGeminiShoppingActions} disabled={taskBusy || pendingShoppingActions.length === 0}>
            {taskBusy ? <Loader2 size={18} className="spin" /> : <ShoppingCart size={18} />}
            Gemini-Items uebernehmen
          </button>
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="iPhone Health Import" />
        <p className="panel-copy">
          Die Web-App kann Apple Health nicht direkt auslesen. Der iOS Shortcut liest echte
          Health-Samples und haengt sie als URL-codiertes JSON an healthPayload.
        </p>
        <div className="form-grid">
          <label className="field field-wide">
            <span>Basis-URL fuer Kurzbefehle</span>
            <textarea
              readOnly
              rows={3}
              value={shortcutBaseUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>

          <label className="field field-wide">
            <span>JSON-Beispiel-Link</span>
            <textarea
              readOnly
              rows={5}
              value={shortcutJsonExampleUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        </div>
        <div className="shortcut-grid">
          <InfoRow
            icon={<FileJson size={17} />}
            title="healthPayload"
            detail="URL-codiertes JSON mit date, sleepHours, steps, restingHeartRate, weightKg und bodyFatPct."
          />
          <InfoRow icon={<Moon size={17} />} title="sleepHours" detail="Zahl in Stunden, z.B. aus Schlaf-Samples der letzten Nacht berechnet." />
          <InfoRow icon={<Activity size={17} />} title="steps" detail="Schritte heute oder gestern, je nachdem wann der Shortcut laeuft." />
          <InfoRow icon={<HeartPulse size={17} />} title="restingHeartRate" detail="Ruhepuls aus Apple Health." />
          <InfoRow icon={<Gauge size={17} />} title="weightKg / bodyFatPct" detail="Letzter Gewicht- und Koerperfettwert, wenn vorhanden." />
        </div>
        <p className="panel-copy">
          Im iPhone-Kurzbefehl: Basis-URL nehmen und healthPayload als URL-codiertes JSON anhaengen.
        </p>
        <div className="button-row">
          <button className="secondary-button" onClick={() => copyText(shortcutBaseUrl)}>
            <ClipboardList size={18} />
            Basis-URL kopieren
          </button>
          <button className="secondary-button" onClick={() => copyText(shortcutJsonExampleUrl)}>
            <ClipboardList size={18} />
            JSON-Beispiel kopieren
          </button>
          <button className="secondary-button" onClick={rotateShortcutToken}>
          <RefreshCw size={18} />
          Token rotieren
        </button>
      </div>
      </section>
    </div>
  );
}

function InsightsScreen({
  data,
  today,
  recovery,
  gymRecommendation,
  todaysNutrition,
}: {
  data: AppData;
  today: string;
  recovery: ReturnType<typeof calculateRecoveryScore>;
  gymRecommendation: ReturnType<typeof recommendGymDay>;
  todaysNutrition: Nutrients;
}) {
  const lastMeals = data.mealEntries.slice().sort(sortByDateDesc).slice(0, 8);
  const sleepSamples = data.healthImports.filter((item) => item.sleepHours).slice().sort(sortByDateDesc).slice(0, 7);
  const avgSleep = sleepSamples.length
    ? round(sleepSamples.reduce((sum, item) => sum + (item.sleepHours ?? 0), 0) / sleepSamples.length, 1)
    : 0;
  const microFlags = [
    { name: "Ballaststoffe", value: todaysNutrition.fiber, target: 30, unit: "g" },
    { name: "Kalium", value: todaysNutrition.potassium, target: 3500, unit: "mg" },
    { name: "Calcium", value: todaysNutrition.calcium, target: 1000, unit: "mg" },
    { name: "Eisen", value: todaysNutrition.iron, target: 8, unit: "mg" },
    { name: "Magnesium", value: todaysNutrition.magnesium, target: 350, unit: "mg" },
  ];
  const evidenceEngine = useMemo(
    () => buildEvidenceEngineSnapshot(data, today),
    [data, today],
  );

  return (
    <div className="screen stack">
      <section className="screen-title">
        <div>
          <small>Insights</small>
          <h1>Performance Cockpit</h1>
        </div>
      </section>

      <div className="metric-grid">
        <MetricCard label="Recovery" value={`${recovery.score}/100`} detail={recovery.summary} icon={<Battery size={18} />} />
        <MetricCard label="7T Schlaf" value={avgSleep ? `${avgSleep} h` : "offen"} icon={<Moon size={18} />} />
        <MetricCard label="Protein" value={`${round(todaysNutrition.protein ?? 0)} g`} detail={nutrientLine(todaysNutrition)} icon={<Flame size={18} />} />
        <MetricCard label="Gym" value={gymRecommendation.planName} detail={gymRecommendation.reason} icon={<Dumbbell size={18} />} />
      </div>

      <section className="panel">
        <SectionHeader title="Mikro-Watchlist" />
        <div className="progress-list">
          {microFlags.map((item) => {
            const value = item.value ?? 0;
            const pct = clamp((value / item.target) * 100, 0, 120);
            return (
              <div key={item.name} className="progress-row">
                <div>
                  <strong>{item.name}</strong>
                  <small>{round(value)} / {item.target} {item.unit}</small>
                </div>
                <span>
                  <i style={{ width: `${pct}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <SectionHeader
          title="Evidence Cards"
          action={
            <Pill tone={evidenceEngine.insightCards.length ? "good" : "warn"}>
              {evidenceEngine.insightCards.length
                ? `${evidenceEngine.insightCards.length} aktiv`
                : "noch schwach"}
            </Pill>
          }
        />

        <div className="insight-card-list">
          {evidenceEngine.insightCards.length === 0 ? (
            <EmptyLine text="Noch keine belastbaren Muster. Das ist korrekt: erst mehr Daten sammeln, dann handeln." />
          ) : (
            evidenceEngine.insightCards.map((card) => (
              <article key={card.id} className="evidence-card">
                <div className="evidence-card-head">
                  <div>
                    <strong>{card.title}</strong>
                    <small>{card.claim}</small>
                  </div>
                  <Pill
                    tone={
                      card.confidence === "strong" || card.confidence === "medium"
                        ? "good"
                        : "warn"
                    }
                  >
                    {card.confidence}
                  </Pill>
                </div>

                <div className="evidence-card-body">
                  <div>
                    <span>Evidence</span>
                    {card.evidence.length ? (
                      <ul>
                        {card.evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <small>Keine Einzelbelege gespeichert.</small>
                    )}
                  </div>

                  <div>
                    <span>Counter</span>
                    {card.counterEvidence.length ? (
                      <ul>
                        {card.counterEvidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <small>Keine Gegenbelege gespeichert.</small>
                    )}
                  </div>
                </div>

                {(card.experiment || card.action) && (
                  <div className="evidence-card-action">
                    {card.experiment && <small>Experiment: {card.experiment}</small>}
                    {card.action && <strong>{card.action}</strong>}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Letzte Mahlzeiten" />
        <MealList meals={lastMeals} />
      </section>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field slider-field">
      <span>
        {label}
        <strong>{value}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function InfoRow({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="info-row">
      <span className="row-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </div>
      {action}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="empty-line">{text}</p>;
}

function MealList({ meals, onRemove }: { meals: MealEntry[]; onRemove?: (id: string) => Promise<void> | void }) {
  if (meals.length === 0) return <EmptyLine text="Noch nichts gespeichert." />;

  return (
    <div className="meal-list">
      {meals.map((meal) => {
        const nutrition = mealEntryNutrition(meal);
        const isQueued = meal.confidence === "needs-gemini";
        return (
          <article key={meal.id} className="meal-row">
            {meal.photo?.thumbnail && <img src={meal.photo.thumbnail} alt="" />}
            <div>
              <strong>{meal.description}</strong>
              <small>
                {displayDate(meal.date)} - {mealLabels[meal.mealType]} - {isQueued ? "Gemini recherchiert Naehrwerte" : nutrientLine(nutrition)}
              </small>
            </div>
            {onRemove ? (
              <button
                className="icon-button danger-icon"
                type="button"
                title="Eintrag loeschen"
                aria-label="Eintrag loeschen"
                onClick={() => onRemove(meal.id)}
              >
                <Trash2 size={17} />
              </button>
            ) : (
              <ChevronRight size={17} />
            )}
          </article>
        );
      })}
    </div>
  );
}

function buildGeminiSnapshot({
  ownerUid,
  settings,
  data,
  recovery,
  gymRecommendation,
}: {
  ownerUid: string;
  settings: AutomationSettings;
  data: AppData;
  recovery: ReturnType<typeof calculateRecoveryScore>;
  gymRecommendation: ReturnType<typeof recommendGymDay>;
}) {
  const takeRecent = <T extends { date?: string; createdAt?: string }>(items: T[], count: number) =>
    items.slice().sort(sortByDateDesc).slice(0, count);
  const shoppingItems = buildShoppingItems(data);
  const nutritionResearchQueue = buildNutritionResearchQueue(data);
  const evidenceEngine = buildEvidenceEngineSnapshot(data, todayKey());

  return toFirestoreObject({
    ownerUid,
    generatedAt: nowIso(),
    evidenceEngine,
    dailyFacts: evidenceEngine.dailyFacts,
    hypotheses: evidenceEngine.hypotheses,
    insightCards: evidenceEngine.insightCards,
    interventionCandidates: evidenceEngine.interventionCandidates,
    gemini: {
      cadence: "hourly_on_the_full_hour",
      nextExpectedRunAt: nextFullHour().toISOString(),
      runTarget: "users/{uid}/geminiRuns",
      snapshotTarget: "users/{uid}/geminiSnapshots/latest",
    },
    privacy: {
      scope: "Private user Firestore document. No public token mirror.",
      drivePhotos: "Photos stay private unless a webViewLink is viewable in the owner's Drive settings.",
    },
    guardrails: [
      "Use evidenceEngine as the primary source.",
      "No diagnosis and no generic wellness filler.",
      "Do not invent nutrition values. Research unknown meals and write nutritionUpdates only with sources and confidence.",
      "Treat nutrition and micronutrients as estimates, not medical diagnosis.",
      "Prefer low-friction meals during exam/performance phases.",
    ],
    currentState: {
      today: todayKey(),
      recovery,
      gymRecommendation,
      latestHealth: latestByDate(data.healthImports),
      latestDailyLog: latestByDate(data.dailyLogs),
      latestBodyStatus: latestByDate(data.bodyStatuses),
      todaysNutrition: nutritionForDate(data.mealEntries, todayKey()),
      nextExpectedGeminiRunAt: nextFullHour().toISOString(),
    },
    shopping: {
      suggestedItems: shoppingItems,
      openItems: data.shoppingList.filter((item) => item.status === "open"),
      checkedRecent: data.shoppingList.filter((item) => item.status === "checked").slice().sort(sortByDateDesc).slice(0, 12),
      targetService: "Healthtracker internal shopping list via geminiRun.taskActions",
      targetListTitle: SHOPPING_LIST_TITLE,
      taskActionContract: {
        action: "add | update | delete | check | note",
        target: SHOPPING_LIST_TITLE,
        item: "concrete shopping item",
        reason: "short why this item matters now",
        priority: "low | medium | high",
      },
    },
    correlationBrief: {
      goal: "Find useful personal patterns for energy, focus, sleep, recovery, soreness, meal timing, caffeine, supplements and study/workload.",
      preserveDetail: true,
      suggestedAnalyses: [
        "late caffeine vs sleep and next-day focus",
        "lunch carbs vs afternoon focus",
        "gym intensity and muscle soreness vs sleep/recovery",
        "micronutrient gaps vs energy/stress/focus",
        "home days and meal prep vs nutrition quality",
        "exam/workload phases vs sleep debt and recovery budget",
      ],
    },
    nutritionResearchQueue,
    raw: {
      dailyLogs: takeRecent(data.dailyLogs, 45),
      healthImports: takeRecent(data.healthImports, 45),
      mealEntries: takeRecent(data.mealEntries, 80),
      supplements: takeRecent(data.supplements, 80),
      trainingSessions: takeRecent(data.trainingSessions, 45),
      homeDays: takeRecent(data.homeDays, 45),
      bodyStatuses: takeRecent(data.bodyStatuses, 45),
      foodReferences: combineFoodReferences(data.foodReferences).slice(0, 80),
      shoppingList: takeRecent(data.shoppingList, 80),
    },
  });
}
