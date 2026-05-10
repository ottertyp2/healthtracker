import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();

const db = getFirestore();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_SOURCE = "firebase-gemini-api";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const REGION = "us-central1";
const RUN_TIME_ZONE = "Europe/Berlin";
const SHOPPING_TARGET = "Healthtracker Einkaufsliste";
const NOOP_SUMMARY = "Keine neue Aktion. Datenlage unveraendert.";
const NOOP_PRIORITY = "Heute Daten vollstaendig halten: Schlaf, Mahlzeiten, Fokus, Stress.";

type RunMode = "noop" | "intervention" | "nutrition_pending";

type GeminiTaskAction = {
  action: "add" | "update" | "delete" | "check" | "note";
  target: string;
  item: string;
  reason?: string;
  priority?: "low" | "medium" | "high";
};

type NutritionUpdate = {
  mealId: string;
  nutrients: Record<string, number>;
  confidence: "high" | "medium";
  assumptions?: string;
  sources?: string[];
};

type GeminiRunPayload = {
  ownerUid: string;
  createdAt: string;
  summary: string;
  insightUpdates: unknown[];
  hypothesisUpdates: unknown[];
  interventionActions: Array<Record<string, unknown>>;
  calendarActions: string[];
  taskActions: GeminiTaskAction[];
  nutritionUpdates: NutritionUpdate[];
  warnings: string[];
  nextPriorities: string[];
  source: typeof GEMINI_SOURCE;
  mode: RunMode;
  runHourKey: string;
};

type RunGeminiResult =
  | { status: "no_snapshot" }
  | { status: "deduped"; mode: RunMode; runHourKey: string }
  | { status: "written"; mode: RunMode; runHourKey: string; runId: string; summary: string };

const geminiRunSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "insightUpdates",
    "hypothesisUpdates",
    "interventionActions",
    "calendarActions",
    "taskActions",
    "nutritionUpdates",
    "warnings",
    "nextPriorities",
    "mode",
  ],
  properties: {
    summary: { type: "string", description: "Short German summary of the run." },
    mode: { type: "string", enum: ["noop", "intervention", "nutrition_pending"] },
    insightUpdates: { type: "array", items: { type: "object", additionalProperties: true } },
    hypothesisUpdates: { type: "array", items: { type: "object", additionalProperties: true } },
    interventionActions: { type: "array", items: { type: "object", additionalProperties: true } },
    calendarActions: { type: "array", items: { type: "string" } },
    taskActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "target", "item"],
        properties: {
          action: { type: "string", enum: ["add", "update", "delete", "check", "note"] },
          target: { type: "string" },
          item: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    nutritionUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["mealId", "nutrients", "confidence"],
        properties: {
          mealId: { type: "string" },
          nutrients: {
            type: "object",
            additionalProperties: { type: "number" },
            description: "Nutrition estimate. Include kcal/protein/carbs/fat and researched micronutrients when supported.",
          },
          confidence: { type: "string", enum: ["high", "medium"] },
          assumptions: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
    nextPriorities: { type: "array", items: { type: "string" } },
  },
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asStringArray(value: unknown, maxItems = 12): string[] {
  return asArray(value)
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, maxItems);
}

function getRunHourKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: RUN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}-${lookup("hour")}`;
}

function normalizeMode(value: unknown, nutritionUpdates: NutritionUpdate[], interventionActions: unknown[]): RunMode {
  if (value === "nutrition_pending" || value === "intervention" || value === "noop") return value;
  if (nutritionUpdates.length > 0) return "nutrition_pending";
  if (interventionActions.length > 0) return "intervention";
  return "noop";
}

function normalizeTaskAction(value: unknown): GeminiTaskAction | undefined {
  const item = asRecord(value);
  if (!item || typeof item.item !== "string" || !item.item.trim()) return undefined;
  const action = ["add", "update", "delete", "check", "note"].includes(String(item.action))
    ? (item.action as GeminiTaskAction["action"])
    : "note";
  const priority = item.priority === "low" || item.priority === "high" ? item.priority : "medium";

  return {
    action,
    target: typeof item.target === "string" && item.target.trim() ? item.target.trim() : SHOPPING_TARGET,
    item: item.item.trim(),
    reason: typeof item.reason === "string" ? item.reason.trim() : undefined,
    priority,
  };
}

function normalizeNutritionUpdate(value: unknown): NutritionUpdate | undefined {
  const item = asRecord(value);
  const nutrients = asRecord(item?.nutrients);
  if (!item || typeof item.mealId !== "string" || !nutrients) return undefined;

  const cleanNutrients = Object.fromEntries(
    Object.entries(nutrients)
      .map(([key, nutrientValue]) => [key, Number(nutrientValue)] as [string, number])
      .filter(([, nutrientValue]) => Number.isFinite(nutrientValue) && nutrientValue >= 0),
  ) as Record<string, number>;

  if (!Object.keys(cleanNutrients).length) return undefined;

  return {
    mealId: item.mealId,
    nutrients: cleanNutrients,
    confidence: item.confidence === "high" ? "high" : "medium",
    assumptions: typeof item.assumptions === "string" ? item.assumptions.trim() : undefined,
    sources: asStringArray(item.sources, 8),
  };
}

function buildPrompt(snapshot: Record<string, unknown>) {
  return [
    "Du bist die Gemini-Auswertung fuer Healthtracker.",
    "Antworte ausschliesslich als JSON nach Schema.",
    "",
    "Ziel:",
    "- Erzeuge genau einen geminiRun fuer Firestore.",
    "- Nutze evidenceEngine, dailyFacts, hypotheses, insightCards und interventionCandidates als Primaerquelle.",
    "- Keine Diagnose, kein Motivationsfuelltext, keine generische Wellness-Beratung.",
    "- Keine externen Task- oder Kalender-APIs. Einkaufsimpulse nur als taskActions fuer die interne Einkaufsliste.",
    "- Wenn interventionCandidates leer ist und keine sichere Naehrwert-Recherche moeglich ist, schreibe einen No-Op.",
    "- Maximal eine neue Hypothese pro Lauf, und nur mit confidence='insufficient'.",
    "- Maximal eine High-Priority-Aktion pro Lauf.",
    "",
    "Nutrition:",
    "- nutritionResearchQueue enthaelt Mahlzeiten, die saubere Naehrwerte brauchen.",
    "- Recherchiere nur, wenn du konkrete Quellen/Productdaten findest.",
    "- Schreibe nutritionUpdates nur mit confidence high oder medium, Annahmen und Quellen.",
    "- Erfinde keine Naehrwerte. Wenn keine Quelle reicht, lass nutritionUpdates leer und schreibe eine warning.",
    "",
    "No-Op Vorlage:",
    JSON.stringify({
      summary: NOOP_SUMMARY,
      mode: "noop",
      insightUpdates: [],
      hypothesisUpdates: [],
      interventionActions: [],
      calendarActions: [],
      taskActions: [],
      nutritionUpdates: [],
      warnings: [],
      nextPriorities: [NOOP_PRIORITY],
    }),
    "",
    "Snapshot:",
    JSON.stringify(snapshot),
  ].join("\n");
}

function parseGeminiText(value: unknown): string {
  const response = asRecord(value);
  const candidates = asArray(response?.candidates);
  const firstCandidate = asRecord(candidates[0]);
  const content = asRecord(firstCandidate?.content);
  const parts = asArray(content?.parts);
  return parts
    .map((part) => asRecord(part)?.text)
    .filter((text): text is string => typeof text === "string")
    .join("")
    .trim();
}

function normalizeGeminiRun(value: unknown, ownerUid: string, createdAt: string, runHourKey: string): GeminiRunPayload {
  const item = asRecord(value) ?? {};
  const nutritionUpdates = asArray(item.nutritionUpdates).map(normalizeNutritionUpdate).filter(Boolean) as NutritionUpdate[];
  const interventionActions = asArray<Record<string, unknown>>(item.interventionActions).filter(Boolean);
  const mode = normalizeMode(item.mode, nutritionUpdates, interventionActions);
  const summary = typeof item.summary === "string" && item.summary.trim()
    ? item.summary.trim()
    : mode === "noop"
      ? NOOP_SUMMARY
      : "Gemini-Lauf gespeichert.";

  return {
    ownerUid,
    createdAt,
    summary,
    insightUpdates: asArray(item.insightUpdates),
    hypothesisUpdates: asArray(item.hypothesisUpdates),
    interventionActions,
    calendarActions: asStringArray(item.calendarActions),
    taskActions: asArray(item.taskActions).map(normalizeTaskAction).filter(Boolean) as GeminiTaskAction[],
    nutritionUpdates,
    warnings: asStringArray(item.warnings),
    nextPriorities: asStringArray(item.nextPriorities).length ? asStringArray(item.nextPriorities) : [NOOP_PRIORITY],
    source: GEMINI_SOURCE,
    mode,
    runHourKey,
  };
}

async function callGemini(snapshot: Record<string, unknown>, ownerUid: string): Promise<GeminiRunPayload> {
  const apiKey = GEMINI_API_KEY.value() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "GEMINI_API_KEY ist noch nicht als Firebase Secret gesetzt.");
  }

  const createdAt = new Date().toISOString();
  const runHourKey = getRunHourKey(new Date(createdAt));
  const response = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(snapshot) }] }],
      tools: GEMINI_MODEL.startsWith("gemini-3") ? [{ googleSearch: {} }] : undefined,
      generationConfig: {
        temperature: 0.2,
        responseFormat: {
          text: {
            mimeType: "application/json",
            schema: geminiRunSchema,
          },
        },
      },
    }),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpsError("internal", `Gemini API ${response.status}: ${responseBody.slice(0, 400)}`);
  }

  const parsedResponse = JSON.parse(responseBody) as unknown;
  const text = parseGeminiText(parsedResponse);
  if (!text) {
    throw new HttpsError("internal", "Gemini API lieferte keinen Textteil.");
  }

  return normalizeGeminiRun(JSON.parse(text), ownerUid, createdAt, runHourKey);
}

async function hasRunForHour(ownerUid: string, runHourKey: string): Promise<boolean> {
  const snapshot = await db
    .collection("users")
    .doc(ownerUid)
    .collection("geminiRuns")
    .where("runHourKey", "==", runHourKey)
    .limit(10)
    .get();

  return snapshot.docs.some((doc) => doc.get("source") === GEMINI_SOURCE);
}

async function writeRunIfAllowed(ownerUid: string, payload: GeminiRunPayload): Promise<RunGeminiResult> {
  if (payload.mode === "noop" && (await hasRunForHour(ownerUid, payload.runHourKey))) {
    logger.info("Skipping noop Gemini run because this hour already has a run.", {
      ownerUid,
      runHourKey: payload.runHourKey,
    });
    return { status: "deduped", mode: payload.mode, runHourKey: payload.runHourKey };
  }

  const created = await db
    .collection("users")
    .doc(ownerUid)
    .collection("geminiRuns")
    .add(payload);

  logger.info("Gemini run written.", {
    ownerUid,
    runHourKey: payload.runHourKey,
    mode: payload.mode,
    runId: created.id,
  });

  return {
    status: "written",
    mode: payload.mode,
    runHourKey: payload.runHourKey,
    runId: created.id,
    summary: payload.summary,
  };
}

async function executeGeminiRun(ownerUid: string): Promise<RunGeminiResult> {
  const snapshotDoc = await db
    .collection("users")
    .doc(ownerUid)
    .collection("geminiSnapshots")
    .doc("latest")
    .get();

  if (!snapshotDoc.exists) {
    logger.warn("Skipping Gemini run because no latest snapshot exists.", { ownerUid });
    return { status: "no_snapshot" };
  }

  const snapshot = asRecord(snapshotDoc.data());
  if (!snapshot) {
    logger.warn("Skipping Gemini run because snapshot shape is invalid.", { ownerUid });
    return { status: "no_snapshot" };
  }

  const payload = await callGemini(snapshot, ownerUid);
  return writeRunIfAllowed(ownerUid, payload);
}

export const runGeminiAnalysis = onCall(
  { region: REGION, secrets: [GEMINI_API_KEY], timeoutSeconds: 180, memory: "512MiB" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Gemini-Lauf braucht Firebase Login.");
    }

    return executeGeminiRun(request.auth.uid);
  },
);

export const runGeminiAnalysisScheduled = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: RUN_TIME_ZONE,
    region: REGION,
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const settings = await db.collectionGroup("settings").get();
    const ownerUids = Array.from(
      new Set(
        settings.docs
          .filter((doc) => doc.id === "automation")
          .map((doc) => doc.get("ownerUid"))
          .filter((ownerUid): ownerUid is string => typeof ownerUid === "string" && Boolean(ownerUid)),
      ),
    );

    for (const ownerUid of ownerUids) {
      try {
        await executeGeminiRun(ownerUid);
      } catch (error) {
        logger.error("Scheduled Gemini run failed.", { ownerUid, error });
      }
    }
  },
);
