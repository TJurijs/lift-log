export function localDateOnly(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dateOnlyDayNumber(value: string) {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid date-only value: ${value}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, monthIndex, day));
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== monthIndex ||
    instant.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date-only value: ${value}`);
  }
  return Math.floor(instant.getTime() / DAY_MS);
}

/** Format a calendar date without letting the device timezone shift its day. */
export function formatDateOnly(
  value: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone">,
  locales?: Intl.LocalesArgument,
) {
  return new Intl.DateTimeFormat(locales, { ...options, timeZone: "UTC" }).format(
    new Date(dateOnlyDayNumber(value) * DAY_MS),
  );
}

export function differenceInCalendarDays(later: string, earlier: string) {
  return dateOnlyDayNumber(later) - dateOnlyDayNumber(earlier);
}

export function addCalendarDays(value: string, amount: number) {
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Calendar-day amount must be an integer");
  }
  const date = new Date((dateOnlyDayNumber(value) + amount) * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function activeWeekForDate(
  effectiveOn: string,
  currentDate: string,
  weekCount: number,
) {
  const elapsedWeeks = Math.floor(
    differenceInCalendarDays(currentDate, effectiveOn) / 7,
  );
  return Math.min(
    Math.max(elapsedWeeks + 1, 1),
    Math.max(Math.trunc(weekCount), 1),
  );
}
