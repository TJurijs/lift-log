/** Workout state stores minutes; short exercise entries use seconds in the UI. */
export function durationSecondsValue(minutes: string) {
  if (!minutes.trim()) return "";
  const value = Number(minutes);
  return Number.isFinite(value) ? String(Math.round(value * 60 * 1000) / 1000) : minutes;
}

export function durationMinutesValue(seconds: string) {
  if (!seconds.trim()) return "";
  const value = Number(seconds.replace(",", "."));
  return Number.isFinite(value) ? String(value / 60) : seconds;
}

export function formatRecordedDuration(minutes: number) {
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${seconds} sec`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
