import { describe, expect, it } from "vitest";

import {
  entryModeForLoggingFormat,
  loggingFormatFor,
  loggingFormatLabel,
  trackingFieldsForLoggingFormat,
} from "../../lib/domain";

describe("exercise logging formats", () => {
  it("distinguishes duration and distance while preserving the result storage mode", () => {
    expect(entryModeForLoggingFormat("duration")).toBe("result");
    expect(entryModeForLoggingFormat("distance")).toBe("result");
    expect(loggingFormatFor("result", ["duration", "rpe"])).toBe("duration");
    expect(loggingFormatFor("result", ["distance", "duration", "rpe"])).toBe(
      "distance",
    );
    expect(loggingFormatLabel("repetitions")).toBe("Repetitions");
  });

  it("keeps required metrics and allows only format-compatible optional metrics", () => {
    expect(
      trackingFieldsForLoggingFormat("repetitions", [
        "load",
        "duration",
        "heartRate",
      ]),
    ).toEqual(["reps", "load"]);
    expect(
      trackingFieldsForLoggingFormat("distance", ["duration", "heartRate"]),
    ).toEqual(["distance", "duration", "heartRate"]);
    expect(trackingFieldsForLoggingFormat("instructions", ["rpe"])).toEqual(
      [],
    );
  });

  it("uses lean defaults instead of inferring tracking from category", () => {
    expect(trackingFieldsForLoggingFormat("repetitions")).toEqual([
      "reps",
      "rpe",
    ]);
    expect(trackingFieldsForLoggingFormat("duration")).toEqual([
      "duration",
      "rpe",
    ]);
  });
});
