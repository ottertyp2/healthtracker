import { bodyMuscleGroups, trainingPlans } from "../data/bodyModel";
import type { BodyStatus, DailyLog, HealthImport, TrainingSession } from "../types";
import { clamp, round } from "./format";
import { daysAgo, todayKey } from "./date";

export type RecoveryScore = {
  score: number;
  label: string;
  summary: string;
  color: "green" | "yellow" | "red";
};

export type GymRecommendation = {
  planName: string;
  score: number;
  reason: string;
  muscleGroups: string[];
  avoid: string[];
  recoveryNeeded: boolean;
};

export function latestByDate<T extends { date: string }>(items: T[], date = todayKey()): T | undefined {
  return [...items].filter((item) => item.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function calculateRecoveryScore(params: {
  dailyLog?: DailyLog;
  daily?: DailyLog;
  healthImport?: HealthImport;
  health?: HealthImport;
  bodyStatus?: BodyStatus;
  body?: BodyStatus;
  trainingSessions?: TrainingSession[];
  recentTraining?: TrainingSession[];
  today?: string;
}): RecoveryScore {
  const daily = params.dailyLog ?? params.daily;
  const health = params.healthImport ?? params.health;
  const body = params.bodyStatus ?? params.body;
  const today = params.today ?? todayKey();
  const recentTraining =
    params.recentTraining ??
    (params.trainingSessions ?? []).filter((session) => session.date >= daysAgoFrom(today, 4));
  const readiness = daily?.readiness ?? daily?.fitness ?? 6;
  const energy = daily?.energy ?? daily?.fitness ?? 6;
  const stressPenalty = daily?.stress ?? 4;
  const focus = daily?.focus ?? 6;
  const sleepHours = health?.sleepHours ?? 7;
  const caffeinePenalty = Math.max(0, ((daily?.caffeineMg ?? 150) - 250) / 80);
  const bodyPenalty = averageBodyLoad(body) / 2.8;
  const trainingPenalty = recentTraining.reduce((sum, item) => sum + item.intensity * 0.18, 0);

  const raw =
    readiness * 8 +
    energy * 7 +
    focus * 4 +
    clamp(sleepHours, 4, 9) * 7 -
    stressPenalty * 5 -
    caffeinePenalty * 3 -
    bodyPenalty * 5 -
    trainingPenalty;

  const score = clamp(Math.round(raw), 0, 100);
  const color = score >= 75 ? "green" : score >= 55 ? "yellow" : "red";
  const label =
    score >= 75 ? "Gruenes Recovery Budget" : score >= 55 ? "Gelbes Recovery Budget" : "Rotes Recovery Budget";
  const summary =
    score >= 75
      ? "Heute ist genug Reserve fuer fokussierte Arbeit und moderates Training da."
      : score >= 55
        ? "Heute lohnt sich ein kontrollierter Tag mit klaren Prioritaeten."
        : "Heute sollte Schlaf, Stressreduktion und niedrige Reibung Vorrang haben.";

  return { score, label, summary, color };
}

export function averageBodyLoad(body?: BodyStatus): number {
  if (!body) return 0;
  const values = Object.values(body.muscles);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value.soreness + value.pain * 1.8, 0) / values.length;
}

export function recommendGymDay(
  body?: BodyStatus,
  trainingSessions: TrainingSession[] = [],
  today = todayKey(),
): GymRecommendation {
  const recentTraining = trainingSessions.filter((session) => session.date >= daysAgoFrom(today, 4));
  const avoided = new Set<string>();

  bodyMuscleGroups.forEach((muscle) => {
    const status = body?.muscles[muscle.id];
    if ((status?.pain ?? 0) >= 4 || (status?.soreness ?? 0) >= 7) avoided.add(muscle.id);
  });

  recentTraining.forEach((session) => {
    if (session.intensity >= 7) {
      session.muscleGroups.forEach((group) => avoided.add(group));
    }
  });

  const bodyLoad = averageBodyLoad(body);
  const planScores = trainingPlans.map((plan) => {
    const blocked = plan.groups.filter((group) => avoided.has(group)).length;
    const directPain = plan.groups.reduce((sum, group) => sum + (body?.muscles[group]?.pain ?? 0), 0);
    const soreness = plan.groups.reduce((sum, group) => sum + (body?.muscles[group]?.soreness ?? 0), 0);
    const systemicPenalty = bodyLoad > 6 && plan.id !== "mobility" ? 28 : 0;
    const legsPenalty = bodyLoad > 4.5 && plan.id === "legs" ? 12 : 0;
    const score = 100 - blocked * 24 - directPain * 5 - soreness * 2 - systemicPenalty - legsPenalty;
    return { plan, score: clamp(score, 0, 100) };
  });

  const best = planScores.sort((a, b) => b.score - a.score)[0];
  const avoidLabels = [...avoided].map((id) => bodyMuscleGroups.find((muscle) => muscle.id === id)?.label ?? id);
  const recoveryNeeded = bodyLoad >= 6.5 || best.plan.id === "mobility";

  if (bodyLoad >= 7.5) {
    return {
      planName: "Recovery Day",
      score: round(100 - bodyLoad * 8),
      muscleGroups: ["core", "glutes"],
      avoid: avoidLabels,
      recoveryNeeded: true,
      reason: "Lokaler Schmerz oder Muskelkater ist hoch. Heute lieber Mobility, Schritte oder Zone 2.",
    };
  }

  return {
    planName: best.plan.name,
    score: best.score,
    muscleGroups: best.plan.groups,
    avoid: avoidLabels,
    recoveryNeeded,
    reason:
      avoidLabels.length > 0
        ? `${best.plan.description} Meiden: ${avoidLabels.slice(0, 4).join(", ")}.`
        : `${best.plan.description} Keine starke lokale Belastung markiert.`,
  };
}

function daysAgoFrom(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00`);
  base.setDate(base.getDate() - days);
  return todayKey(base);
}
