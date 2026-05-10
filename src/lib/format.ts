import type { Nutrients } from "../types";

export function round(value?: number, digits = 0): number {
  if (value == null || Number.isNaN(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function nutrientLine(nutrients: Nutrients): string {
  return `${round(nutrients.kcal)} kcal | P ${round(nutrients.protein)}g | C ${round(nutrients.carbs)}g | F ${round(nutrients.fat)}g`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
