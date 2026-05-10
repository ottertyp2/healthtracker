export function todayKey(date: Date | string = new Date()): string {
  if (typeof date === "string") return date.slice(0, 10);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDays(date: Date | string, days: number): string {
  const base = typeof date === "string" ? new Date(`${date.slice(0, 10)}T12:00:00`) : new Date(date);
  base.setDate(base.getDate() + days);
  return todayKey(base);
}

export function daysAgo(days: number): string {
  return addDays(new Date(), -days);
}

export function displayDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

export const formatShortDate = displayDate;

export function nextDays(count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(new Date(), index));
}

export function sortByDateDesc<T extends { date?: string; createdAt?: string }>(a: T, b: T): number {
  const aKey = a.date ?? a.createdAt ?? "";
  const bKey = b.date ?? b.createdAt ?? "";
  return bKey.localeCompare(aKey);
}

export function byDateDesc<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort(sortByDateDesc);
}
