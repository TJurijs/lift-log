import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appDetailFromHistory,
  appViewHash,
  leaveAppDetailHistory,
  parseAppView,
  pushAppDetailHistory,
  updateAppViewUrl,
} from "../../lib/app-route";

afterEach(() => vi.restoreAllMocks());

describe("app view routing", () => {
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

  it("uses browser back only when the current entry is an app detail", () => {
    window.history.replaceState({}, "", "/#/today");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    expect(leaveAppDetailHistory()).toBe(false);

    pushAppDetailHistory("workout", "today");
    expect(leaveAppDetailHistory()).toBe(true);
    expect(back).toHaveBeenCalledOnce();
  });
});
