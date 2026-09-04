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
    window.history.replaceState({}, "", "/#/program");
    pushAppDetailHistory("program", "program");
    updateAppViewUrl("program");
    expect(appDetailFromHistory()).toBeNull();
    expect(window.location.hash).toBe("#/program");
  });
  it("parses supported hash routes and defaults safely", () => {
    expect(parseAppView("#/calendar")).toBe("calendar");
    expect(parseAppView("#program")).toBe("program");
    expect(parseAppView("")).toBe("today");
    expect(parseAppView("#/unknown")).toBe("today");
  });

  it("retains query parameters while updating browser history", () => {
    window.history.replaceState({}, "", "/?preview=mobile#/today");
    updateAppViewUrl("exercises");
    expect(window.location.search).toBe("?preview=mobile");
    expect(window.location.hash).toBe(appViewHash("exercises"));
  });

  it("records detail navigation without losing preview parameters", () => {
    window.history.replaceState({}, "", "/?preview=mobile#/program");
    pushAppDetailHistory("program", "program");

    expect(appDetailFromHistory()).toBe("program");
    expect(window.location.search).toBe("?preview=mobile");
    expect(window.location.hash).toBe(appViewHash("program"));
  });

  it("replaces one detail with another instead of stacking nested screens", () => {
    window.history.replaceState({}, "", "/#/today");
    const replace = vi.spyOn(window.history, "replaceState");
    pushAppDetailHistory("workout", "today");
    pushAppDetailHistory("workout-log", "today");

    expect(replace).toHaveBeenCalledTimes(1);
    expect(appDetailFromHistory()).toBe("workout-log");
  });

  it("can stack a completed result over its program detail for native back", () => {
    window.history.replaceState({}, "", "/#/program");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    pushAppDetailHistory("program", "program");
    push.mockClear();

    pushAppDetailHistory("workout-log", "today", {
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
        returnView: "program",
      },
    });

    expect(push).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(appDetailFromHistory()).toBe("workout-log");
    expect(appDetailDataFromHistory()).toMatchObject({
      kind: "workout-log",
      athleteId: "athlete-1",
      returnView: "program",
      session: { id: "session-1" },
    });
    expect(window.location.hash).toBe(appViewHash("today"));
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

    pushAppDetailHistory("workout-log", "today", {
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
    window.history.replaceState({}, "", "/#/program");

    pushAppDetailHistory("program", "program", {
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

    pushAppDetailHistory("program", "program");

    expect(appDetailFromHistory()).toBe("program");
    expect(appDetailDataFromHistory()).toBeNull();
  });

  it("uses browser back only when the current entry is an app detail", () => {
    window.history.replaceState({}, "", "/#/today");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    expect(leaveAppDetailHistory()).toBe(false);

    pushAppDetailHistory("workout", "today");
    expect(leaveAppDetailHistory()).toBe(true);
    expect(back).toHaveBeenCalledOnce();
  });
});
