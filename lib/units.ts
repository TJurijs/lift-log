import type { OwnProfile } from "./domain";

export const KG_PER_LB = 0.45359237;
export const KM_PER_MILE = 1.609344;

/** Draft distances are always kilometres; only presentation follows the profile. */
export function formatDistanceKilometres(
  valueKm: number,
  unit: OwnProfile["distanceUnit"],
) {
  const displayed = unit === "mi" ? valueKm / KM_PER_MILE : valueKm;
  return Number(displayed.toFixed(3)).toString();
}

export function distanceInputValue(valueKm: string, unit: OwnProfile["distanceUnit"]) {
  const parsed = Number(valueKm);
  return valueKm.trim() && Number.isFinite(parsed)
    ? formatDistanceKilometres(parsed, unit)
    : valueKm;
}

export function distanceKilometresValue(value: string, unit: OwnProfile["distanceUnit"]) {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed)) return value;
  return Number((unit === "mi" ? parsed * KM_PER_MILE : parsed).toFixed(6)).toString();
}

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
