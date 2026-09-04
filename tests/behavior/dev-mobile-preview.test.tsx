import userEvent from "@testing-library/user-event";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authHarness = vi.hoisted(() => ({ initialize: vi.fn(), getSession: vi.fn(), getClient: vi.fn() }));
vi.mock("../../lib/auth", () => ({ getSupabaseBrowserClient: authHarness.getClient }));

import { DevMobilePreview } from "../../app/DevMobilePreview";
import { getDevMobilePreviewState } from "../../lib/dev-mobile-preview";

describe("development mobile preview", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/?preview=mobile");
    authHarness.initialize.mockReset().mockResolvedValue({ error: null });
    authHarness.getSession.mockReset();
    authHarness.getClient.mockReset();
    authHarness.getClient.mockReturnValue({ auth: { initialize: authHarness.initialize, getSession: authHarness.getSession } });
  });
  it.each([
    { DEV: true, MODE: "development" },
    { DEV: false, MODE: "nonprod" },
    { DEV: false, MODE: "localdev" },
  ])("supports the development environment $MODE (DEV=$DEV)", (environment) => {
    for (const preview of ["mobile", "mobil"]) {
      expect(getDevMobilePreviewState(environment, `?preview=${preview}`)).toEqual({ isPreview: true, isFrame: false });
      expect(getDevMobilePreviewState(environment, `?preview=${preview}&preview_frame=1`)).toEqual({ isPreview: false, isFrame: true });
    }
    expect(getDevMobilePreviewState(environment, "?preview=desktop")).toEqual({ isPreview: false, isFrame: false });
    expect(getDevMobilePreviewState(environment, "?preview_frame=1")).toEqual({ isPreview: false, isFrame: false });
  });

  it("keeps preview and frame behavior disabled in production", () => {
    for (const search of ["?preview=mobile", "?preview=mobil", "?preview=mobile&preview_frame=1"]) {
      expect(getDevMobilePreviewState({ DEV: false, MODE: "production" }, search)).toEqual({ isPreview: false, isFrame: false });
    }
  });

  it("renders only the iPhone 15 and Samsung Galaxy A54 frames and lets the developer switch", async () => {
    const user = userEvent.setup();
    render(<DevMobilePreview />);

    const frame = screen.getByTitle("Lift Log mobile preview");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /iPhone 15/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Samsung Galaxy A54/ })).toBeVisible();
    expect(frame.getAttribute("style")).toContain("--mobile-preview-width: 393px");
    expect(frame.getAttribute("style")).toContain("--mobile-preview-height: 852px");
    expect(frame).toHaveAttribute("src", expect.stringContaining("preview_frame=1"));

    await user.selectOptions(screen.getByLabelText("Viewport"), "samsung-a54");
    expect(frame.getAttribute("style")).toContain("--mobile-preview-width: 412px");
    expect(frame.getAttribute("style")).toContain("--mobile-preview-height: 915px");
    expect(authHarness.getClient).not.toHaveBeenCalled();
  });

  it.each([
    "?preview=mobile&coach_invite=invite#access_token=secret&refresh_token=refresh&expires_in=3600&token_type=bearer",
    "?preview=mobile&coach_invite=invite&code=secret&sb_flow_id=flow#/today",
  ])("consumes the outer auth callback before exposing a clean iframe (%s)", async (path) => {
    window.history.replaceState({}, "", `/${path}`);
    let resolve!: (value: { data: { session: object }; error: null }) => void;
    authHarness.getSession.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<DevMobilePreview />);

    expect(screen.getByRole("status")).toHaveTextContent("Completing sign-in");
    expect(screen.queryByTitle("Lift Log mobile preview")).not.toBeInTheDocument();
    await act(async () => { resolve({ data: { session: { user: { id: "athlete" } } }, error: null }); });

    const frame = await screen.findByTitle("Lift Log mobile preview");
    for (const url of [new URL(frame.getAttribute("src")!), new URL(window.location.href)]) {
      expect(url.searchParams.get("coach_invite")).toBe("invite");
      expect(url.searchParams.get("preview")).toBe("mobile");
      expect(url.href).not.toMatch(/secret|refresh|access_token|sb_flow_id|code=|expires_in|token_type/);
      expect(url.hash).toBe(path.endsWith("#/today") ? "#/today" : "");
    }
    expect(new URL(frame.getAttribute("src")!).searchParams.get("preview_frame")).toBe("1");
    expect(new URL(window.location.href).searchParams.has("preview_frame")).toBe(false);
  });

  it.each(["rejection", "returned-error", "no-session", "provider-error"])("offers a fresh sign-in without forwarding failed callback credentials (%s)", async (failure) => {
    const providerError = failure === "provider-error" ? "&error=access_denied&error_description=private-details" : "";
    window.history.replaceState({}, "", `/?preview=mobile#access_token=secret&refresh_token=refresh${providerError}`);
    if (failure === "rejection") authHarness.getSession.mockRejectedValue(new Error("Storage unavailable"));
    else authHarness.getSession.mockResolvedValue({
      data: { session: failure === "provider-error" ? { user: { id: "previous-user" } } : null },
      error: failure === "returned-error" ? new Error("Invalid callback") : null,
    });
    render(<DevMobilePreview />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in didn’t complete");
    expect(screen.queryByTitle("Lift Log mobile preview")).not.toBeInTheDocument();
    expect(window.location.href).not.toMatch(/secret|refresh|private-details|access_denied/);
    await userEvent.click(screen.getByRole("button", { name: "Open sign-in" }));
    const frame = screen.getByTitle("Lift Log mobile preview");
    expect(frame.getAttribute("src")).not.toMatch(/secret|refresh|private-details|access_denied/);
  });

  it("does not mistake an existing account for a successful callback when initialization failed", async () => {
    window.history.replaceState({}, "", "/?preview=mobile#access_token=invalid&refresh_token=refresh");
    authHarness.initialize.mockResolvedValue({ error: new Error("Invalid callback token") });
    authHarness.getSession.mockResolvedValue({ data: { session: { user: { id: "previous-account" } } }, error: null });
    render(<DevMobilePreview />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in didn’t complete");
    expect(authHarness.getSession).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Lift Log mobile preview")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
});
