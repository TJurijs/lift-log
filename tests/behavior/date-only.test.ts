import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  activeWeekForDate,
  addCalendarDays,
  differenceInCalendarDays,
  formatDateOnly,
  localDateOnly,
} from "../../lib/date-only";

const originalTimezone = process.env.TZ;

describe("localDateOnly", () => {
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it.each([
    ["2026-01-15T04:59:59.999Z", "2026-01-14"],
    ["2026-01-15T05:00:00.000Z", "2026-01-15"],
    ["2026-07-15T03:59:59.999Z", "2026-07-14"],
    ["2026-07-15T04:00:00.000Z", "2026-07-15"],
  ])("formats %s on the correct side of local midnight", (instant, expected) => {
    expect(localDateOnly(new Date(instant))).toBe(expected);
  });

  it.each([
    ["2026-03-08T06:59:59.999Z", "2026-03-08"],
    ["2026-03-08T07:00:00.000Z", "2026-03-08"],
    ["2026-11-01T05:59:59.999Z", "2026-11-01"],
    ["2026-11-01T06:00:00.000Z", "2026-11-01"],
  ])("keeps %s on its local date across a DST transition", (instant, expected) => {
    expect(localDateOnly(new Date(instant))).toBe(expected);
  });

  it("uses the current local date when called without an argument", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T04:59:59.999Z"));

    expect(localDateOnly()).toBe("2026-03-07");
  });
});

describe("date-only calendar arithmetic", () => {
  it("formats date-only values without moving them across local midnight", () => {
    expect(formatDateOnly("2026-03-08", { year: "numeric", month: "long", day: "numeric" }, "en-US"))
      .toBe("March 8, 2026");
    expect(() => formatDateOnly("2026-02-30", { day: "numeric" }, "en-US"))
      .toThrow("Invalid date-only value");
  });
  it.each([
    ["2026-03-07", 1, "2026-03-08"],
    ["2026-03-08", 1, "2026-03-09"],
    ["2026-10-31", 1, "2026-11-01"],
    ["2026-11-01", 1, "2026-11-02"],
    ["2026-01-01", -1, "2025-12-31"],
  ])("adds %s calendar days to %s without DST drift", (value, amount, expected) => {
    expect(addCalendarDays(value, amount)).toBe(expected);
  });

  it("counts calendar boundaries rather than elapsed 24-hour blocks", () => {
    expect(differenceInCalendarDays("2026-03-09", "2026-03-02")).toBe(7);
    expect(differenceInCalendarDays("2026-11-02", "2026-10-26")).toBe(7);
  });

  it.each([
    ["2026-03-02", "2026-03-08", 12, 1],
    ["2026-03-02", "2026-03-09", 12, 2],
    ["2026-10-26", "2026-11-02", 12, 2],
    ["2026-03-02", "2026-05-31", 4, 4],
    ["2026-03-02", "2026-02-20", 4, 1],
  ])(
    "maps an effective date and current date to the bounded active week",
    (effectiveOn, currentDate, weekCount, expected) => {
      expect(activeWeekForDate(effectiveOn, currentDate, weekCount)).toBe(expected);
    },
  );

  it.each(["2026-02-30", "2026-13-01", "not-a-date"])(
    "rejects invalid date-only input %s",
    (value) => {
      expect(() => differenceInCalendarDays(value, "2026-01-01")).toThrow(
        "Invalid date-only value",
      );
    },
  );
});
