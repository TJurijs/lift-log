import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { startGoogleSignIn } from "../../lib/google-sign-in";

function fixture(search = "?preview=mobile&preview_frame=1&coach_invite=invitation-token") {
  const assign = vi.fn();
  const top = { location: { origin: "https://dev.liftlog.cc", assign } };
  const browser = {
    location: { origin: "https://dev.liftlog.cc", search },
    self: {},
    top,
  };
  const auth = {
    signInWithOAuth: vi.fn<SupabaseClient["auth"]["signInWithOAuth"]>().mockResolvedValue({
      data: { provider: "google", url: "https://auth.example.test/authorize" },
      error: null,
    }),
  };
  return { auth, browser, assign };
}

describe("Google sign-in from the development mobile preview", () => {
  it.each(["mobile", "mobil"])("opens OAuth in the outer window for a compiled nonprod %s frame", async (preview) => {
    const { auth, browser, assign } = fixture(`?preview=${preview}&preview_frame=1&coach_invite=invitation-token`);
    await startGoogleSignIn(auth, browser, { DEV: false, MODE: "nonprod" });

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://dev.liftlog.cc/?coach_invite=invitation-token&preview=mobile",
        skipBrowserRedirect: true,
      },
    });
    expect(assign).toHaveBeenCalledWith("https://auth.example.test/authorize");
  });

  it.each([
    { label: "top-level app", environment: { DEV: false, MODE: "nonprod" }, search: "?coach_invite=invitation-token", framed: false },
    { label: "top-level preview-frame URL", environment: { DEV: false, MODE: "nonprod" }, search: "?preview=mobile&preview_frame=1&coach_invite=invitation-token", framed: false },
    { label: "production iframe", environment: { DEV: false, MODE: "production" }, search: "?preview=mobile&preview_frame=1&coach_invite=invitation-token", framed: true },
    { label: "unrelated iframe", environment: { DEV: true, MODE: "development" }, search: "?preview_frame=1&coach_invite=invitation-token", framed: true },
  ])("preserves ordinary SDK redirects for the $label", async ({ environment, search, framed }) => {
    const { auth, browser, assign } = fixture(search);
    if (!framed) browser.self = browser.top;
    await startGoogleSignIn(auth, browser, environment);

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://dev.liftlog.cc/?coach_invite=invitation-token" },
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("requires a same-origin outer window before requesting preview OAuth", async () => {
    const { auth, browser, assign } = fixture();
    browser.top.location.origin = "https://other.example.test";
    await expect(startGoogleSignIn(auth, browser, { DEV: false, MODE: "nonprod" })).rejects.toThrow("same-origin");
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("surfaces missing preview redirect URLs without navigating", async () => {
    const { auth, browser, assign } = fixture();
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: "" }, error: null });
    await expect(startGoogleSignIn(auth, browser, { DEV: false, MODE: "nonprod" })).rejects.toThrow("redirect URL");
    expect(assign).not.toHaveBeenCalled();
  });

  it("preserves rejected sign-in errors without navigating the outer window", async () => {
    const { auth, browser, assign } = fixture();
    const failure = new Error("Provider unavailable");
    auth.signInWithOAuth.mockRejectedValue(failure);
    await expect(startGoogleSignIn(auth, browser, { DEV: false, MODE: "nonprod" })).rejects.toBe(failure);
    expect(assign).not.toHaveBeenCalled();
  });
});
