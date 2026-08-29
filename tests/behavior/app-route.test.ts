import { describe, expect, it } from "vitest";
import { appViewHash, parseAppView, updateAppViewUrl } from "../../lib/app-route";

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
});

