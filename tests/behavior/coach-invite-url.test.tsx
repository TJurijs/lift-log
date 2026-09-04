import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevMobilePreview } from "../../app/DevMobilePreview";
import { clearAcceptedCoachInvite } from "../../lib/google-sign-in";

const environment = { DEV: false, MODE: "nonprod" };

function urlWindow(path: string, origin = window.location.origin) {
  const location = { origin, href: new URL(path, origin).href };
  const state = { navigation: "preserved" };
  const history = {
    state,
    replaceState: vi.fn((_state: unknown, _unused: string, next?: string | URL | null) => {
      location.href = String(next);
    }),
  };
  return { location, history };
}

function fixture() {
  const parent = urlWindow("/?preview=mobile&coach_invite=accepted&filter=keep#/calendar");
  const child = {
    ...urlWindow("/?preview=mobile&preview_frame=1&coach_invite=accepted&filter=keep#/coaching"),
    parent,
    self: {},
  };
  return { child, parent };
}

afterEach(() => window.history.replaceState({}, "", "/"));

describe("accepted coach invitation URLs", () => {
  it("clears the matching parent token so the next preview frame cannot replay it", () => {
    const { child, parent } = fixture();
    clearAcceptedCoachInvite("accepted", child, environment);

    expect(new URL(child.location.href).searchParams.has("coach_invite")).toBe(false);
    expect(new URL(child.location.href).hash).toBe("#/coaching");
    expect(parent.location.href).toBe(`${window.location.origin}/?preview=mobile&filter=keep#/calendar`);
    expect(parent.history.replaceState).toHaveBeenCalledWith(parent.history.state, "", expect.any(URL));

    window.history.replaceState({}, "", parent.location.href);
    render(<DevMobilePreview />);
    const frameUrl = new URL(screen.getByTitle("Lift Log mobile preview").getAttribute("src")!);
    expect(frameUrl.searchParams.has("coach_invite")).toBe(false);
    expect(frameUrl.searchParams.get("preview_frame")).toBe("1");
    expect(frameUrl.searchParams.get("filter")).toBe("keep");
    expect(frameUrl.hash).toBe("#/calendar");
  });

  it("preserves a different invitation added to either window during acceptance", () => {
    const { child, parent } = fixture();
    child.location.href = child.location.href.replace("coach_invite=accepted", "coach_invite=next-child");
    parent.location.href = parent.location.href.replace("coach_invite=accepted", "coach_invite=next-parent");
    clearAcceptedCoachInvite("accepted", child, environment);
    expect(child.history.replaceState).not.toHaveBeenCalled();
    expect(parent.history.replaceState).not.toHaveBeenCalled();
  });

  it.each(["ordinary-frame", "top-level", "production", "cross-origin"])("does not rewrite the parent of a %s", (scenario) => {
    const { child, parent } = fixture();
    if (scenario === "ordinary-frame") child.location.href = child.location.href.replace("preview=mobile&", "");
    if (scenario === "top-level") child.self = parent;
    if (scenario === "cross-origin") parent.location.origin = "https://other.example.test";
    clearAcceptedCoachInvite("accepted", child, scenario === "production" ? { DEV: false, MODE: "production" } : environment);
    expect(child.history.replaceState).toHaveBeenCalledOnce();
    expect(parent.history.replaceState).not.toHaveBeenCalled();
  });

  it("keeps accepted-invite cleanup successful if the parent becomes inaccessible", () => {
    const { child, parent } = fixture();
    Object.defineProperty(parent, "location", { get() { throw new DOMException("Cross-origin window", "SecurityError"); } });
    expect(() => clearAcceptedCoachInvite("accepted", child, environment)).not.toThrow();
    expect(new URL(child.location.href).searchParams.has("coach_invite")).toBe(false);
  });
});
