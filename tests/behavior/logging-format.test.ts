import { describe, expect, it } from "vitest";

import {
  entryModeForLoggingFormat,
  loggingFormatFor,
  loggingFormatLabel,
  recordingSummary,
  trackingFieldsForMode,
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
    expect(loggingFormatLabel("repetitions")).toBe("Reps");
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
    expect(trackingFieldsForLoggingFormat("repetitions")).toEqual(["reps"]);
    expect(trackingFieldsForLoggingFormat("duration")).toEqual(["duration"]);
    expect(trackingFieldsForLoggingFormat("distance")).toEqual(["distance", "duration"]);
    expect(trackingFieldsForMode("sets")).toEqual(["reps"]);
  });

  it("recognizes timed and distance sets without adding repetitions", () => {
    expect(loggingFormatFor("sets", ["duration"])).toBe("duration");
    expect(loggingFormatFor("sets", ["duration", "distance", "load"])).toBe("distance");
    expect(trackingFieldsForMode("sets", ["duration", "heartRate"])).toEqual(["duration", "heartRate"]);
    expect(trackingFieldsForMode("sets", ["distance", "duration", "rpe"])).toEqual(["distance", "duration", "rpe"]);
  });

  it("restores only a meaningful primary field for empty or incompatible configurations", () => {
    expect(trackingFieldsForMode("sets", [])).toEqual(["reps"]);
    expect(trackingFieldsForMode("sets", ["rounds", "heartRate"])).toEqual(["reps"]);
    expect(trackingFieldsForMode("sets", ["load", "rpe"])).toEqual(["reps", "load", "rpe"]);
    expect(trackingFieldsForMode("result", ["reps"])).toEqual(["duration"]);
    expect(trackingFieldsForMode("intervals", ["load"])).toEqual(["rounds", "duration"]);
    expect(trackingFieldsForMode("none", ["reps", "load"])).toEqual([]);
  });

  it("keeps deliberately selected old fields while describing them once", () => {
    expect(trackingFieldsForLoggingFormat("distance", ["distance", "rpe"])).toEqual(["distance", "rpe"]);
    expect(recordingSummary("sets", ["reps", "load", "rpe"])).toBe("Reps + weight · RPE");
    expect(recordingSummary("sets", ["duration"])).toBe("Time");
    expect(recordingSummary("result", ["distance", "duration", "heartRate"])).toBe("Distance + time · Heart rate");
    expect(recordingSummary("none", [])).toBe("Instructions");
  });
});
