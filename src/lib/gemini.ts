import type { AppData, GeminiTaskAction, Nutrients } from "../types";

type GeminiPriority = "low" | "medium" | "high";
type GeminiConfidence = "high" | "medium";

export type GeminiNutritionUpdate = {
  mealId: string;
  nutrients: Nutrients;
  confidence: GeminiConfidence;
  assumptions?: string;
  sources: string[];
};

export type GeminiAutomationInput = {
  today: string;
  data: AppData;
  recovery: unknown;
  gymRecommendation: unknown;
  nutritionResearchQueue: unknown[];
  shoppingItems: string[];
  trackedNutrientKeys: readonly string[];
};

export type GeminiAutomationResult = {
  summary: string;
  taskActions: GeminiTaskAction[];
  nutritionUpdates: GeminiNutritionUpdate[];
  warnings: string[];
  nextPriorities: string[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const automationResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    taskActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["add", "update", "delete", "check", "note"] },
          target: { type: "string" },
          item: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["action", "target", "item"],
      },
    },
    nutritionUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          mealId: { type: "string" },
          nutrients: {
            type: "object",
            additionalProperties: false,
            properties: {
              kcal: { type: "number" },
              protein: { type: "number" },
              carbs: { type: "number" },
              fat: { type: "number" },
              fiber: { type: "number" },
              sugar: { type: "number" },
              sodium: { type: "number" },
              salt: { type: "number" },
              potassium: { type: "number" },
              calcium: { type: "number" },
              magnesium: { type: "number" },
              iron: { type: "number" },
              zinc: { type: "number" },
              iodine: { type: "number" },
              vitaminD: { type: "number" },
              caffeine: { type: "number" },
            },
            required: ["kcal", "protein", "carbs", "fat"],
          },
          confidence: { type: "string", enum: ["high", "medium"] },
          assumptions: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
        },
        required: ["mealId", "nutrients", "confidence", "sources"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
    nextPriorities: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "taskActions", "nutritionUpdates", "warnings", "nextPriorities"],
};

export function geminiModel() {
  return import.meta.env.VITE_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function hasGeminiConfig() {
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function isPriority(value: unknown): value is GeminiPriority {
  return value === "low" || value === "medium" || value === "high";
}

function isTaskAction(value: unknown): value is GeminiTaskAction["action"] {
  return value === "add" || value === "update" || value === "delete" || value === "check" || value === "note";
}

function sanitizeTaskAction(value: unknown): GeminiTaskAction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const item = typeof raw.item === "string" ? raw.item.trim() : "";
  const target = typeof raw.target === "string" ? raw.target.trim() : "shopping";
  const action = isTaskAction(raw.action) ? raw.action : "note";
  if (!item) return null;
  return {
    action,
    target,
    item,
    reason: typeof raw.reason === "string" ? raw.reason.trim() : undefined,
    priority: isPriority(raw.priority) ? raw.priority : undefined,
  };
}

function sanitizeNutrients(value: unknown): Nutrients | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const kcal = Number(raw.kcal);
  const protein = Number(raw.protein);
  const carbs = Number(raw.carbs);
  const fat = Number(raw.fat);
  if (![kcal, protein, carbs, fat].every(Number.isFinite)) return null;
  const nutrients: Nutrients = { kcal, protein, carbs, fat };
  for (const [key, rawValue] of Object.entries(raw)) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      (nutrients as Record<string, number>)[key] = parsed;
    }
  }
  return nutrients;
}

function sanitizeNutritionUpdate(value: unknown): GeminiNutritionUpdate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const mealId = typeof raw.mealId === "string" ? raw.mealId.trim() : "";
  const nutrients = sanitizeNutrients(raw.nutrients);
  if (!mealId || !nutrients) return null;
  return {
    mealId,
    nutrients,
    confidence: raw.confidence === "high" ? "high" : "medium",
    assumptions: typeof raw.assumptions === "string" ? raw.assumptions.trim() : undefined,
    sources: toStringArray(raw.sources),
  };
}

function extractGeminiText(payload: GeminiResponse) {
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) {
    throw new Error(payload.error?.message || "Gemini hat keine auswertbare Antwort geliefert.");
  }
  return text;
}

function sanitizeGeminiResult(value: unknown): GeminiAutomationResult {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini-Antwort hat kein gueltiges JSON-Objekt geliefert.");
  }
  const raw = value as Record<string, unknown>;
  return {
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    taskActions: Array.isArray(raw.taskActions)
      ? raw.taskActions.map(sanitizeTaskAction).filter((item): item is GeminiTaskAction => Boolean(item))
      : [],
    nutritionUpdates: Array.isArray(raw.nutritionUpdates)
      ? raw.nutritionUpdates.map(sanitizeNutritionUpdate).filter((item): item is GeminiNutritionUpdate => Boolean(item))
      : [],
    warnings: toStringArray(raw.warnings),
    nextPriorities: toStringArray(raw.nextPriorities),
  };
}

export async function generateGeminiAutomationRun(input: GeminiAutomationInput): Promise<GeminiAutomationResult> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY fehlt.");
  }

  const instruction = [
    "Du bist die Gemini-Automation fuer eine private Healthtracker-App.",
    "Analysiere nur die gelieferten App-Daten.",
    "Erstelle keine medizinische Diagnose.",
    "Schaetze Naehrwerte nur fuer Eintraege aus nutritionResearchQueue.",
    "Nutze plausible, konservative Standardwerte und nenne Quellen/Annahmen.",
    "Gib ausschliesslich JSON zurueck, passend zum Schema.",
    "taskActions duerfen Einkaufslisten-Vorschlaege enthalten.",
    "nutritionUpdates muessen mealId, kcal, protein, carbs und fat enthalten.",
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify({ instruction, input }, null, 2) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseFormat: {
            text: {
              mimeType: "application/json",
              schema: automationResultSchema,
            },
          },
        },
      }),
    },
  );

  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini API Fehler ${response.status}`);
  }
  return sanitizeGeminiResult(JSON.parse(extractGeminiText(payload)));
}
