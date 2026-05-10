import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();

const db = getFirestore();

const AGENT_TOKEN = "agent_d9346b520773dffccf60cc6d809ddd6e9b26";
const AGENT_SOURCE = "firebase-scheduled-agent";
const SHOPPING_TARGET = "Healthtracker Einkaufsliste";
const RUN_TIME_ZONE = "Europe/Berlin";
const NOOP_SUMMARY = "Keine neue Aktion. Datenlage unverändert.";
const NOOP_PRIORITY = "Heute Daten vollständig halten: Schlaf, Mahlzeiten, Fokus, Stress.";
const NUTRITION_PENDING_WARNING =
  "NutritionResearchQueue enthält Einträge, automatische Recherche ist noch nicht aktiviert.";

type RunMode = "noop" | "intervention" | "nutrition_pending";

type InsightCard = {
  confidence?: string;
};

type ActionWindow = {
  start?: string;
  end?: string;
};

type InterventionCandidate = {
  id?: string;
  trigger?: string;
  hypothesisId?: string;
  recommendation?: string;
  message?: string;
  expectedBenefit?: string;
  friction?: string;
  confidence?: string;
  actionWindow?: ActionWindow;
};

type AgentTaskAction = {
  action: "add" | "note";
  target: string;
  item: string;
  reason?: string;
  priority?: "low" | "medium" | "high";
};

type AgentRunPayload = {
  createdAt: string;
  summary: string;
  insightUpdates: unknown[];
  hypothesisUpdates: unknown[];
  interventionActions: Array<Record<string, unknown>>;
  calendarActions: string[];
  taskActions: AgentTaskAction[];
  nutritionUpdates: unknown[];
  warnings: string[];
  nextPriorities: string[];
  source: typeof AGENT_SOURCE;
  mode: RunMode;
  runHourKey: string;
};

type RunAgentResult =
  | { status: "no_snapshot" }
  | { status: "deduped"; mode: RunMode; runHourKey: string }
  | { status: "written"; mode: RunMode; runHourKey: string; runId: string; summary: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeFriction(value: unknown): "low" | "medium" | "high" {
  return value === "low" || value === "high" ? value : "medium";
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  return value === "low" || value === "high" ? value : "medium";
}

function isActionableInsight(card: InsightCard): boolean {
  return card.confidence === "medium" || card.confidence === "strong";
}

function hasOnlyWeakInsights(insightCards: InsightCard[]): boolean {
  return insightCards.length === 0 || insightCards.every((card) => !isActionableInsight(card));
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

function formatActionWindow(actionWindow: ActionWindow): string[] {
  if (!actionWindow.start || !actionWindow.end) return [];

  return [
    `Aktionsfenster: ${actionWindow.start} bis ${actionWindow.end}.`,
  ];
}

function buildTaskActions(candidate: InterventionCandidate): AgentTaskAction[] {
  const trigger = String(candidate.trigger ?? "");
  if (!trigger.includes("home_day") && !trigger.includes("nutrition")) {
    return [];
  }

  if (trigger === "home_day_low_protein") {
    return [
      {
        action: "add",
        target: SHOPPING_TARGET,
        item: "Eier oder Skyr für Zuhause-Tag",
        reason: "Low-Friction Protein-Mahlzeit für den geplanten Zuhause-Tag.",
        priority: "medium",
      },
    ];
  }

  return [
    {
      action: "note",
      target: SHOPPING_TARGET,
      item: "Ernährungs-Trigger prüfen und passendes Low-Friction Essen vorbereiten",
      reason: "Deterministischer Task aus einem Nutrition/Home-Day Trigger.",
      priority: "medium",
    },
  ];
}

function buildInterventionAction(candidate: InterventionCandidate, createdAt: string) {
  const trigger = String(candidate.trigger ?? "scheduled_intervention");
  const recommendation = String(candidate.recommendation ?? candidate.message ?? "Priorisierte Intervention aus Snapshot.");
  const expectedBenefit = String(candidate.expectedBenefit ?? "Belastung reduzieren und nächste Stunden strukturieren.");

  return {
    id: `${trigger}-${createdAt}`,
    createdAt,
    trigger,
    hypothesisId: typeof candidate.hypothesisId === "string" ? candidate.hypothesisId : undefined,
    recommendation,
    expectedBenefit,
    friction: normalizeFriction(candidate.friction),
    confidence: normalizeConfidence(candidate.confidence),
    actionWindow:
      candidate.actionWindow?.start && candidate.actionWindow?.end
        ? {
            start: candidate.actionWindow.start,
            end: candidate.actionWindow.end,
          }
        : undefined,
    result: "unknown",
  };
}

function buildNoOpRun(createdAt: string, runHourKey: string): AgentRunPayload {
  return {
    createdAt,
    summary: NOOP_SUMMARY,
    insightUpdates: [],
    hypothesisUpdates: [],
    interventionActions: [],
    calendarActions: [],
    taskActions: [],
    nutritionUpdates: [],
    warnings: [],
    nextPriorities: [NOOP_PRIORITY],
    source: AGENT_SOURCE,
    mode: "noop",
    runHourKey,
  };
}

function buildNutritionPendingRun({
  createdAt,
  runHourKey,
  hasActionableInsights,
}: {
  createdAt: string;
  runHourKey: string;
  hasActionableInsights: boolean;
}): AgentRunPayload {
  return {
    createdAt,
    summary: hasActionableInsights
      ? "Es gibt neue Hinweise, aber die Nutrition Research Queue ist noch nicht automatisiert."
      : "Nutrition Research steht an, automatische Recherche ist noch nicht aktiviert.",
    insightUpdates: [],
    hypothesisUpdates: [],
    interventionActions: [],
    calendarActions: [],
    taskActions: [],
    nutritionUpdates: [],
    warnings: [NUTRITION_PENDING_WARNING],
    nextPriorities: [
      "Offene Mahlzeiten später manuell prüfen und Daten weiter vollständig halten.",
      NOOP_PRIORITY,
    ],
    source: AGENT_SOURCE,
    mode: "nutrition_pending",
    runHourKey,
  };
}

function buildInsightOnlyRun({
  createdAt,
  runHourKey,
}: {
  createdAt: string;
  runHourKey: string;
}): AgentRunPayload {
  return {
    createdAt,
    summary: "Es gibt Hinweise im Snapshot, aber keine deterministische Hauptaktion ohne Intervention Candidate.",
    insightUpdates: [],
    hypothesisUpdates: [],
    interventionActions: [],
    calendarActions: [],
    taskActions: [],
    nutritionUpdates: [],
    warnings: [],
    nextPriorities: [
      "Beobachtete Muster weiter mit vollständigen Tagesdaten absichern.",
      NOOP_PRIORITY,
    ],
    source: AGENT_SOURCE,
    mode: "noop",
    runHourKey,
  };
}

function buildInterventionRun({
  createdAt,
  runHourKey,
  candidate,
  hasNutritionQueue,
}: {
  createdAt: string;
  runHourKey: string;
  candidate: InterventionCandidate;
  hasNutritionQueue: boolean;
}): AgentRunPayload {
  const interventionAction = buildInterventionAction(candidate, createdAt);
  const calendarActions = interventionAction.actionWindow
    ? formatActionWindow(interventionAction.actionWindow)
    : [];
  const taskActions = buildTaskActions(candidate);

  return {
    createdAt,
    summary: interventionAction.recommendation,
    insightUpdates: [],
    hypothesisUpdates: [],
    interventionActions: [interventionAction],
    calendarActions,
    taskActions,
    nutritionUpdates: [],
    warnings: hasNutritionQueue ? [NUTRITION_PENDING_WARNING] : [],
    nextPriorities: [
      interventionAction.recommendation,
      NOOP_PRIORITY,
    ],
    source: AGENT_SOURCE,
    mode: "intervention",
    runHourKey,
  };
}

async function hasRunForHour(runHourKey: string): Promise<boolean> {
  const snapshot = await db
    .collection("agentAccess")
    .doc(AGENT_TOKEN)
    .collection("agentRuns")
    .where("runHourKey", "==", runHourKey)
    .limit(10)
    .get();

  return snapshot.docs.some((doc) => doc.get("source") === AGENT_SOURCE);
}

async function writeRunIfAllowed(payload: AgentRunPayload): Promise<RunAgentResult> {
  if (payload.mode === "noop" && (await hasRunForHour(payload.runHourKey))) {
    logger.info("Skipping noop agent run because this hour already has a run.", {
      agentToken: AGENT_TOKEN,
      runHourKey: payload.runHourKey,
      source: AGENT_SOURCE,
    });
    return {
      status: "deduped",
      mode: payload.mode,
      runHourKey: payload.runHourKey,
    };
  }

  const created = await db
    .collection("agentAccess")
    .doc(AGENT_TOKEN)
    .collection("agentRuns")
    .add(payload);

  logger.info("Agent run written.", {
    agentToken: AGENT_TOKEN,
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

async function executeAgentRun(trigger: "scheduled" | "manual"): Promise<RunAgentResult> {
  const snapshotRef = db
    .collection("agentAccess")
    .doc(AGENT_TOKEN)
    .collection("snapshots")
    .doc("latest");
  const snapshotDoc = await snapshotRef.get();

  if (!snapshotDoc.exists) {
    logger.warn("Skipping agent run because no latest snapshot exists.", {
      agentToken: AGENT_TOKEN,
      trigger,
    });
    return { status: "no_snapshot" };
  }

  const snapshot = asRecord(snapshotDoc.data());
  if (!snapshot) {
    logger.warn("Skipping agent run because snapshot shape is invalid.", {
      agentToken: AGENT_TOKEN,
      trigger,
    });
    return { status: "no_snapshot" };
  }

  const evidenceEngine = asRecord(snapshot.evidenceEngine);
  const interventionCandidates = asArray<InterventionCandidate>(snapshot.interventionCandidates);
  const insightCards = asArray<InsightCard>(snapshot.insightCards);
  const hypotheses = asArray(snapshot.hypotheses);
  const nutritionResearchQueue = asArray(snapshot.nutritionResearchQueue);
  const currentState = asRecord(snapshot.currentState);
  void evidenceEngine;
  void hypotheses;
  void currentState;

  const createdAt = new Date().toISOString();
  const runHourKey = getRunHourKey(new Date(createdAt));
  const hasNutritionQueue = nutritionResearchQueue.length > 0;
  const hasActionableInsights = insightCards.some(isActionableInsight);

  if (interventionCandidates.length > 0) {
    return writeRunIfAllowed(
      buildInterventionRun({
        createdAt,
        runHourKey,
        candidate: interventionCandidates[0],
        hasNutritionQueue,
      }),
    );
  }

  if (hasNutritionQueue) {
    return writeRunIfAllowed(
      buildNutritionPendingRun({
        createdAt,
        runHourKey,
        hasActionableInsights,
      }),
    );
  }

  if (hasOnlyWeakInsights(insightCards)) {
    return writeRunIfAllowed(buildNoOpRun(createdAt, runHourKey));
  }

  return writeRunIfAllowed(
    buildInsightOnlyRun({
      createdAt,
      runHourKey,
    }),
  );
}

export const runHealthAgentScheduled = onSchedule("every 60 minutes", async () => {
  await executeAgentRun("scheduled");
});

export const runHealthAgentManual = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Manual agent run requires a signed-in user.");
  }

  return executeAgentRun("manual");
});
