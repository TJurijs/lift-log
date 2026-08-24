import type { OwnProfile } from "./domain";

export const KG_PER_LB = 0.45359237;

export function formatWeight(
  valueKg: number,
  weightUnit: OwnProfile["weightUnit"],
) {
  const displayValue = weightUnit === "lb" ? valueKg / KG_PER_LB : valueKg;
  return Number(displayValue.toFixed(weightUnit === "lb" ? 1 : 2)).toString();
}

export function weightInputValue(
  valueKg: string,
  weightUnit: OwnProfile["weightUnit"],
) {
  const parsed = Number(valueKg);
  return valueKg.trim() && Number.isFinite(parsed)
    ? formatWeight(parsed, weightUnit)
    : valueKg;
}

export function weightKgValue(
  value: string,
  weightUnit: OwnProfile["weightUnit"],
) {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed)) return value;
  const kilograms = weightUnit === "lb" ? parsed * KG_PER_LB : parsed;
  return Number(kilograms.toFixed(3)).toString();
}
