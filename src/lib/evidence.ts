import type {
  AppData,
  DailyFact,
  HealthHypothesis,
  InsightCard,
  Intervention,
  MealEntry,
  Nutrients,
} from "../types";
import { mergeNutrients, zeroNutrients } from "../data/defaultFoods";
import { addDays, nowIso, todayKey } from "./date";
import { round } from "./format";

type NumericFact = Record<string, unknown>;

export type RecommendationCandidate = {
  message: string;
  trigger: string;
  evidence: string[];
  confidence: number;
  estimatedImpact: number;
  friction: number;
  urgency: number;
  expectedBenefit: string;
  actionWindow?: {
    start: string;
    end: string;
  };
  hypothesisId?: string;
};

export type EvidenceEngineSnapshot = {
  dailyFacts: DailyFact[];
  hypotheses: HealthHypothesis[];
  insightCards: InsightCard[];
  interventionCandidates: Intervention[];
  protocol: {
    maxHighPriorityActionsPerRun: number;
    maxLowFrictionSuggestionsPerDay: number;
    maxNewHypothesesPerDay: number;
    noOpWhenScoreBelow: number;
  };
};

const LOOKBACK_DAYS = 30;
const INTERVENTION_THRESHOLD = 0.22;

export function buildEvidenceEngineSnapshot(
  data: AppData,
  referenceDate = todayKey(),
): EvidenceEngineSnapshot {
  const dailyFacts = buildDailyFacts(data, referenceDate, LOOKBACK_DAYS);
  const hypotheses = evaluateHypotheses(dailyFacts, seedHypotheses());
  const insightCards = buildInsightCards(hypotheses, dailyFacts);
  const interventionCandidates = buildInterventions(
    buildRecommendationCandidates(dailyFacts, hypotheses, referenceDate),
  );

  return {
    dailyFacts,
    hypotheses,
    insightCards,
    interventionCandidates,
    protocol: {
      maxHighPriorityActionsPerRun: 1,
      maxLowFrictionSuggestionsPerDay: 2,
      maxNewHypothesesPerDay: 1,
      noOpWhenScoreBelow: INTERVENTION_THRESHOLD,
    },
  };
}

export function buildDailyFacts(
  data: AppData,
  referenceDate = todayKey(),
  lookbackDays = LOOKBACK_DAYS,
): DailyFact[] {
  return Array.from({ length: lookbackDays }, (_, index) => addDays(referenceDate, -index))
    .sort()
    .map((date) => buildDailyFactForDate(data, date));
}

function buildDailyFactForDate(data: AppData, date: string): DailyFact {
  const dailyLog = data.dailyLogs.find((item) => item.date === date);
  const healthImport = data.healthImports.find((item) => item.date === date);
  const meals = data.mealEntries.filter((item) => item.date === date);
  const training = data.trainingSessions.filter((item) => item.date === date);
  const homeDay = data.homeDays.find((item) => item.date === date);
  const bodyStatus = data.bodyStatuses.find((item) => item.date === date);
  const nutrients = sumMealNutrients(meals);

  const timedProteinMeals = meals
    .map((meal) => ({
      time: extractTime(meal.capturedAt),
      protein: mealEntryNutrition(meal).protein ?? 0,
    }))
    .filter((item) => item.time && item.protein > 0)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));

  const lastMealTime = meals
    .map((meal) => extractTime(meal.capturedAt))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const sorenessValues = bodyStatus
    ? Object.values(bodyStatus.muscles).map((item) => item.soreness)
    : [];

  const painValues = bodyStatus
    ? Object.values(bodyStatus.muscles).map((item) => item.pain)
    : [];

  return {
    id: date,
    date,

    sleepHours: healthImport?.sleepHours,
    sleepStart: healthImport?.sleepStart,
    sleepEnd: healthImport?.sleepEnd,
    sleepDebt7d: calculateSleepDebt7d(data, date),
    restingHeartRate: healthImport?.restingHeartRate,
    steps: healthImport?.steps,

    energy: dailyLog?.energy ?? dailyLog?.fitness,
    focus: dailyLog?.focus,
    stress: dailyLog?.stress,
    sleepQuality: dailyLog?.sleepQuality,

    caffeineTotalMg: dailyLog?.caffeineMg,
    caffeineAfter14Mg: undefined,
    lastCaffeineTime: undefined,

    kcal: nutrients.kcal,
    protein: nutrients.protein,
    proteinBefore12g: timedProteinMeals
      .filter((item) => String(item.time) < "12:00")
      .reduce((sum, item) => sum + item.protein, 0),
    fiber: nutrients.fiber,
    magnesium: nutrients.magnesium,
    potassium: nutrients.potassium,
    vitaminD: nutrients.vitaminD,
    omega3: nutrients.omega3,

    firstProteinTime: timedProteinMeals[0]?.time,
    lastMealTime,
    mealRegularityScore: calculateMealRegularityScore(meals),

    trainingLoad: training.reduce(
      (sum, item) => sum + item.intensity * ((item.durationMin ?? 45) / 45),
      0,
    ),
    trainedMuscles: Array.from(new Set(training.flatMap((item) => item.muscleGroups))),
    sorenessLoad: average(sorenessValues),
    painLoad: average(painValues),

    isHome: homeDay?.isHome ?? homeDay?.status === "home",

    dataQuality: {
      nutrition: meals.length >= 3 ? "high" : meals.length >= 1 ? "medium" : "low",
      sleep: healthImport?.sleepHours ? "high" : "low",
      subjective: dailyLog ? "high" : "low",
    },
  };
}

function seedHypotheses(): HealthHypothesis[] {
  const updatedAt = nowIso();

  return [
    {
      id: "late-caffeine-sleep",
      title: "Spätes Koffein verschiebt Schlaf",
      causeMetric: "caffeineAfter14Mg",
      outcomeMetric: "sleepHours",
      lagDays: 0,
      direction: "lower_is_better",
      minObservations: 8,
      observations: 0,
      confidence: "insufficient",
      evidenceSummary: "Noch keine auswertbaren Koffein-Zeitpunkte vorhanden.",
      suggestedExperiment: {
        action: "7 Tage kein Koffein nach 14:00",
        durationDays: 7,
        successMetric: "sleepHours + sleepQuality",
      },
      status: "watching",
      updatedAt,
    },
    {
      id: "early-protein-focus",
      title: "Protein vor Mittag verbessert Fokus",
      causeMetric: "proteinBefore12g",
      outcomeMetric: "focus",
      lagDays: 0,
      direction: "higher_is_better",
      minObservations: 8,
      observations: 0,
      confidence: "insufficient",
      evidenceSummary: "Noch nicht genug Tage mit Protein- und Fokusdaten.",
      suggestedExperiment: {
        action: "An Zuhause-Tagen Frühstück mit 35g+ Protein",
        durationDays: 5,
        successMetric: "focus",
      },
      status: "watching",
      updatedAt,
    },
    {
      id: "sleep-debt-energy",
      title: "Schlafschuld drückt Energie",
      causeMetric: "sleepDebt7d",
      outcomeMetric: "energy",
      lagDays: 0,
      direction: "lower_is_better",
      minObservations: 8,
      observations: 0,
      confidence: "insufficient",
      evidenceSummary: "Noch nicht genug gekoppelte Schlaf- und Energiedaten.",
      suggestedExperiment: {
        action: "3 Abende Schlafschutz vor 22:30 starten",
        durationDays: 3,
        successMetric: "energy + sleepHours",
      },
      status: "watching",
      updatedAt,
    },
  ];
}

function evaluateHypotheses(
  facts: DailyFact[],
  hypotheses: HealthHypothesis[],
): HealthHypothesis[] {
  return hypotheses.map((hypothesis) => evaluateHypothesis(facts, hypothesis));
}

function evaluateHypothesis(facts: DailyFact[], hypothesis: HealthHypothesis): HealthHypothesis {
  const paired = facts
    .map((fact) => ({
      date: fact.date,
      cause: numericValue(fact, hypothesis.causeMetric),
      outcome: numericValue(fact, hypothesis.outcomeMetric),
    }))
    .filter(
      (item): item is { date: string; cause: number; outcome: number } =>
        typeof item.cause === "number" && typeof item.outcome === "number",
    );

  if (paired.length < hypothesis.minObservations) {
    return {
      ...hypothesis,
      observations: paired.length,
      confidence: "insufficient",
      effectEstimate: undefined,
      evidenceSummary: `Nur ${paired.length}/${hypothesis.minObservations} auswertbare Beobachtungen.`,
      counterEvidence: "Mindestanzahl noch nicht erreicht.",
      updatedAt: nowIso(),
    };
  }

  const sorted = [...paired].sort((a, b) => a.cause - b.cause);
  const middle = Math.floor(sorted.length / 2);
  const lowCause = sorted.slice(0, middle);
  const highCause = sorted.slice(middle);

  const lowOutcome = average(lowCause.map((item) => item.outcome)) ?? 0;
  const highOutcome = average(highCause.map((item) => item.outcome)) ?? 0;
  const rawEffect = round(highOutcome - lowOutcome, 2);
  const alignedEffect = hypothesis.direction === "higher_is_better" ? rawEffect : rawEffect * -1;

  const confidence =
    paired.length >= 14 && Math.abs(alignedEffect) >= 1
      ? "strong"
      : paired.length >= 10 && Math.abs(alignedEffect) >= 0.6
        ? "medium"
        : Math.abs(alignedEffect) >= 0.3
          ? "weak"
          : "insufficient";

  return {
    ...hypothesis,
    observations: paired.length,
    effectEstimate: rawEffect,
    confidence,
    evidenceSummary:
      confidence === "insufficient"
        ? `${paired.length} Beobachtungen, aber Effekt noch zu klein oder uneindeutig.`
        : `${paired.length} Beobachtungen. Geschätzter Unterschied: ${rawEffect} bei ${hypothesis.outcomeMetric}.`,
    counterEvidence:
      confidence === "insufficient"
        ? "Datenlage spricht noch nicht für eine belastbare Aussage."
        : undefined,
    updatedAt: nowIso(),
  };
}

function buildInsightCards(
  hypotheses: HealthHypothesis[],
  facts: DailyFact[],
): InsightCard[] {
  return hypotheses
    .filter((hypothesis) => hypothesis.confidence !== "insufficient")
    .slice(0, 4)
    .map((hypothesis) => {
      const evidence = facts
        .filter(
          (fact) =>
            numericValue(fact, hypothesis.causeMetric) !== undefined &&
            numericValue(fact, hypothesis.outcomeMetric) !== undefined,
        )
        .slice(-5)
        .map(
          (fact) =>
            `${fact.date}: ${hypothesis.causeMetric}=${numericValue(
              fact,
              hypothesis.causeMetric,
            )}, ${hypothesis.outcomeMetric}=${numericValue(fact, hypothesis.outcomeMetric)}`,
        );

      return {
        id: `insight-${hypothesis.id}`,
        createdAt: nowIso(),
        title: hypothesis.title,
        claim: hypothesis.evidenceSummary,
        evidence,
        counterEvidence: hypothesis.counterEvidence ? [hypothesis.counterEvidence] : [],
        confidence: hypothesis.confidence,
        experiment: hypothesis.suggestedExperiment?.action,
        action:
          hypothesis.confidence === "medium" || hypothesis.confidence === "strong"
            ? hypothesis.suggestedExperiment?.action
            : undefined,
      };
    });
}

function buildRecommendationCandidates(
  facts: DailyFact[],
  hypotheses: HealthHypothesis[],
  referenceDate: string,
): RecommendationCandidate[] {
  const today = facts.find((fact) => fact.date === referenceDate) ?? facts.at(-1);
  if (!today) return [];

  const candidates: RecommendationCandidate[] = [];

  if ((today.sleepHours ?? 8) < 6.5 && (today.stress ?? 0) >= 6) {
    candidates.push({
      trigger: "low_sleep_high_stress",
      message:
        "Heute keinen harten Gym-Block mehr. 25 Minuten Spaziergang, simples Abendessen und maximal ein kurzer Lernblock.",
      evidence: [
        `Schlaf: ${today.sleepHours ?? "offen"}h`,
        `Stress: ${today.stress ?? "offen"}/10`,
      ],
      confidence: 0.72,
      estimatedImpact: 0.72,
      friction: 0.22,
      urgency: 0.88,
      expectedBenefit: "Schlafrisiko senken und nächsten Tag stabilisieren.",
      actionWindow: {
        start: `${referenceDate}T18:00:00`,
        end: `${referenceDate}T21:30:00`,
      },
    });
  }

  if ((today.isHome ?? false) && (today.protein ?? 0) < 120) {
    candidates.push({
      trigger: "home_day_low_protein",
      message:
        "Für den Zuhause-Tag eine Low-Friction Protein-Mahlzeit einplanen: Eier/Skyr/Rinderhack plus Kartoffeln oder Brot.",
      evidence: [
        `Protein heute: ${round(today.protein ?? 0)}g`,
        `Zuhause-Tag: ${today.isHome ? "ja" : "nein"}`,
      ],
      confidence: 0.68,
      estimatedImpact: 0.64,
      friction: 0.3,
      urgency: 0.62,
      expectedBenefit: "Weniger Entscheidungsaufwand und bessere Proteinabdeckung.",
      hypothesisId: hypotheses.find((item) => item.id === "early-protein-focus")?.id,
    });
  }

  if ((today.sleepDebt7d ?? 0) >= 4) {
    candidates.push({
      trigger: "sleep_debt_7d",
      message:
        "Heute Schlafschutz priorisieren: kein spätes schweres Essen, keine intensive Einheit, Abendroutine früher starten.",
      evidence: [`7T Schlafschuld: ${round(today.sleepDebt7d ?? 0, 1)}h`],
      confidence: 0.74,
      estimatedImpact: 0.76,
      friction: 0.35,
      urgency: 0.82,
      expectedBenefit: "Schlafschuld reduzieren und Recovery verbessern.",
      hypothesisId: hypotheses.find((item) => item.id === "sleep-debt-energy")?.id,
    });
  }

  return candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
}

function buildInterventions(candidates: RecommendationCandidate[]): Intervention[] {
  return candidates
    .filter((candidate) => scoreCandidate(candidate) > INTERVENTION_THRESHOLD)
    .slice(0, 2)
    .map((candidate) => ({
      id: `intervention-${candidate.trigger}-${Date.now()}`,
      createdAt: nowIso(),
      trigger: candidate.trigger,
      hypothesisId: candidate.hypothesisId,
      recommendation: candidate.message,
      expectedBenefit: candidate.expectedBenefit,
      friction:
        candidate.friction < 0.25 ? "low" : candidate.friction < 0.55 ? "medium" : "high",
      confidence:
        candidate.confidence >= 0.75 ? "high" : candidate.confidence >= 0.55 ? "medium" : "low",
      actionWindow: candidate.actionWindow,
      result: "unknown",
    }));
}

function scoreCandidate(candidate: RecommendationCandidate): number {
  return candidate.confidence * candidate.estimatedImpact * candidate.urgency - candidate.friction;
}

function sumMealNutrients(meals: MealEntry[]): Nutrients {
  return meals.reduce(
    (sum, meal) => mergeNutrients(sum, mealEntryNutrition(meal)),
    zeroNutrients(),
  );
}

function mealEntryNutrition(meal: MealEntry): Nutrients {
  const itemTotal = meal.items.reduce(
    (sum, item) => mergeNutrients(sum, item.nutrients ?? zeroNutrients()),
    zeroNutrients(),
  );

  const hasItemNutrition = Object.values(itemTotal).some((value) => (value ?? 0) > 0);
  return hasItemNutrition ? itemTotal : meal.total ?? meal.nutritionEstimate ?? zeroNutrients();
}

function calculateSleepDebt7d(data: AppData, date: string): number | undefined {
  const samples = Array.from({ length: 7 }, (_, index) => addDays(date, -index))
    .map((sampleDate) => data.healthImports.find((item) => item.date === sampleDate)?.sleepHours)
    .filter((value): value is number => typeof value === "number");

  if (!samples.length) return undefined;

  return round(
    samples.reduce((sum, value) => sum + Math.max(0, 7.5 - value), 0),
    1,
  );
}

function calculateMealRegularityScore(meals: MealEntry[]): number | undefined {
  if (!meals.length) return undefined;

  const expectedMeals = ["breakfast", "lunch", "dinner"];
  const matchedMeals = expectedMeals.filter((mealType) =>
    meals.some((meal) => meal.mealType === mealType),
  ).length;

  return round((matchedMeals / expectedMeals.length) * 100);
}

function extractTime(value?: string): string | undefined {
  if (!value) return undefined;

  const isoMatch = value.match(/T(\d{2}:\d{2})/);
  if (isoMatch) return isoMatch[1];

  const simpleMatch = value.match(/^(\d{2}:\d{2})/);
  return simpleMatch?.[1];
}

function numericValue(item: NumericFact, key: string): number | undefined {
  const value = item[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function average(values: number[]): number | undefined {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return undefined;

  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}
