import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appDetailDataFromHistory,
  appDetailFromHistory,
  appViewHash,
  leaveAppDetailHistory,
  parseAppView,
  pushAppDetailHistory,
  updateAppViewUrl,
} from "../../lib/app-route";

afterEach(() => vi.restoreAllMocks());

describe("app view routing", () => {
  it("top-level navigation clears detail state even when the hash is unchanged", () => {
    window.history.replaceState({}, "", "/#/training");
    pushAppDetailHistory("program", "training");
    updateAppViewUrl("training");
    expect(appDetailFromHistory()).toBeNull();
    expect(window.location.hash).toBe("#/training");
  });
  it("parses supported hash routes and defaults safely", () => {
    expect(parseAppView("#/calendar")).toBe("calendar");
    expect(parseAppView("#/training")).toBe("training");
    expect(parseAppView("#/workout")).toBe("workout");
    expect(parseAppView("#program")).toBe("training");
    expect(parseAppView("#/today")).toBe("training");
    expect(parseAppView("")).toBe("training");
    expect(parseAppView("#/unknown")).toBe("training");
  });

  it("retains query parameters while updating browser history", () => {
    window.history.replaceState({}, "", "/?preview=mobile#/today");
    updateAppViewUrl("exercises");
    expect(window.location.search).toBe("?preview=mobile");
    expect(window.location.hash).toBe(appViewHash("exercises"));
  });

  it("records detail navigation without losing preview parameters", () => {
    window.history.replaceState({}, "", "/?preview=mobile#/training");
    pushAppDetailHistory("program", "training");

    expect(appDetailFromHistory()).toBe("program");
    expect(window.location.search).toBe("?preview=mobile");
    expect(window.location.hash).toBe(appViewHash("training"));
  });

  it("replaces one detail with another instead of stacking nested screens", () => {
    window.history.replaceState({}, "", "/#/today");
    const replace = vi.spyOn(window.history, "replaceState");
    pushAppDetailHistory("workout", "workout");
    pushAppDetailHistory("workout-log", "workout");

    expect(replace).toHaveBeenCalledTimes(1);
    expect(appDetailFromHistory()).toBe("workout-log");
  });

  it("can stack a completed result over its program detail for native back", () => {
    window.history.replaceState({}, "", "/#/training");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    pushAppDetailHistory("program", "training");
    push.mockClear();

    pushAppDetailHistory("workout-log", "workout", {
      stackOnDetail: true,
      data: {
        kind: "workout-log",
        session: {
          id: "session-1",
          workoutTitle: "Snatch technique",
          date: "2026-09-03",
          durationMinutes: 55,
          rpe: 8,
        },
        athleteId: "athlete-1",
        returnView: "training",
      },
    });

    expect(push).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(appDetailFromHistory()).toBe("workout-log");
    expect(appDetailDataFromHistory()).toMatchObject({
      kind: "workout-log",
      athleteId: "athlete-1",
      returnView: "training",
      session: { id: "session-1" },
    });
    expect(window.location.hash).toBe(appViewHash("workout"));
  });

  it("stores a mobile athlete drill-down in native history", () => {
    window.history.replaceState({}, "", "/#/coaching");

    pushAppDetailHistory("coach-athlete", "coaching", {
      data: {
        kind: "coach-athlete",
        athleteId: "athlete-7",
        tab: "history",
      },
    });

    expect(appDetailFromHistory()).toBe("coach-athlete");
    expect(appDetailDataFromHistory()).toEqual({
      kind: "coach-athlete",
      athleteId: "athlete-7",
      tab: "history",
    });
  });

  it("stacks a completed result over the exact coach History context", () => {
    window.history.replaceState({}, "", "/#/coaching");
    pushAppDetailHistory("coach-athlete", "coaching", {
      data: {
        kind: "coach-athlete",
        athleteId: "athlete-7",
        tab: "history",
      },
    });
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");

    pushAppDetailHistory("workout-log", "workout", {
      stackOnDetail: true,
      data: {
        kind: "workout-log",
        session: {
          id: "session-coach-1",
          workoutTitle: "Clean pulls",
          date: "2026-09-03",
          durationMinutes: 48,
          rpe: 8,
        },
        athleteId: "athlete-7",
        returnView: "coaching",
      },
    });

    expect(push).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(appDetailDataFromHistory()).toMatchObject({
      kind: "workout-log",
      athleteId: "athlete-7",
      returnView: "coaching",
    });
  });

  it("stores enough identity to restore an exact program or run", () => {
    window.history.replaceState({}, "", "/#/training");

    pushAppDetailHistory("program", "training", {
      data: {
        kind: "program",
        programId: "program-1",
        programVersionId: "version-4",
        athleteId: "athlete-7",
        assignmentId: "assignment-2",
        programRunId: "run-9",
        workoutId: "workout-3",
        returnView: "coaching",
      },
    });

    expect(appDetailDataFromHistory()).toEqual({
      kind: "program",
      programId: "program-1",
      programVersionId: "version-4",
      athleteId: "athlete-7",
      assignmentId: "assignment-2",
      programRunId: "run-9",
      workoutId: "workout-3",
      returnView: "coaching",
    });
  });

  it("does not leak one detail payload into the next history entry", () => {
    window.history.replaceState({}, "", "/#/coaching");
    pushAppDetailHistory("coach-athlete", "coaching", {
      data: { kind: "coach-athlete", athleteId: "athlete-7", tab: "plan" },
    });

    pushAppDetailHistory("program", "training");

    expect(appDetailFromHistory()).toBe("program");
    expect(appDetailDataFromHistory()).toBeNull();
  });

  it("uses browser back only when the current entry is an app detail", () => {
    window.history.replaceState({}, "", "/#/today");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    expect(leaveAppDetailHistory()).toBe(false);

    pushAppDetailHistory("workout", "workout");
    expect(leaveAppDetailHistory()).toBe(true);
    expect(back).toHaveBeenCalledOnce();
  });
});
