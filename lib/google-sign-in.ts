import type { SupabaseClient } from "@supabase/supabase-js";
import { devMobilePreviewEnabled, getDevMobilePreviewState } from "./dev-mobile-preview";

const authCallbackFields = [
  "access_token", "refresh_token", "provider_token", "provider_refresh_token",
  "expires_in", "expires_at", "token_type", "type", "code", "sb_flow_id",
  "error", "error_code", "error_description",
];

export function hasAuthCallbackParameters(url: URL) {
  const hash = new URLSearchParams(url.hash.slice(1));
  return authCallbackFields.some((field) => field !== "type"
    && (url.searchParams.has(field) || hash.has(field)));
}

export function hasAuthCallbackError(url: URL) {
  const hash = new URLSearchParams(url.hash.slice(1));
  return ["error", "error_code", "error_description"].some((field) =>
    url.searchParams.has(field) || hash.has(field));
}

/** Preserve application/invitation routing while removing OAuth credentials. */
export function withoutAuthCallbackParameters(url: URL) {
  const clean = new URL(url);
  const hash = new URLSearchParams(clean.hash.slice(1));
  const hashHasCallback = authCallbackFields.some((field) => hash.has(field));
  for (const field of authCallbackFields) {
    clean.searchParams.delete(field);
    hash.delete(field);
  }
  if (hashHasCallback) clean.hash = hash.toString();
  return clean;
}

interface GoogleSignInWindow {
  location: Pick<Location, "origin" | "search">;
  self: unknown;
  top: { location: Pick<Location, "origin" | "assign"> } | null;
}

/** OAuth providers must open outside the development preview's iframe. */
export async function startGoogleSignIn(
  auth: Pick<SupabaseClient["auth"], "signInWithOAuth">,
  browser: GoogleSignInWindow = window,
  environment: Pick<ImportMetaEnv, "DEV" | "MODE"> = {
    DEV: import.meta.env.DEV,
    MODE: import.meta.env.MODE,
  },
) {
  const params = new URLSearchParams(browser.location.search);
  const isPreviewFrame = devMobilePreviewEnabled
    && getDevMobilePreviewState(environment, browser.location.search).isFrame
    && browser.self !== browser.top;
  const outerWindow = isPreviewFrame ? browser.top : null;
  if (isPreviewFrame && outerWindow?.location.origin !== browser.location.origin) {
    throw new Error("Mobile preview sign-in requires a same-origin outer window");
  }

  const redirectTo = new URL(browser.location.origin);
  const invitationToken = params.get("coach_invite");
  if (invitationToken) redirectTo.searchParams.set("coach_invite", invitationToken);
  if (isPreviewFrame) redirectTo.searchParams.set("preview", "mobile");

  const { data, error } = await auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo.href,
      ...(isPreviewFrame ? { skipBrowserRedirect: true } : {}),
    },
  });
  if (error) throw error;
  if (outerWindow) {
    if (!data?.url) throw new Error("Google sign-in did not return a redirect URL");
    outerWindow.location.assign(data.url);
  }
}
