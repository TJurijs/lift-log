import type { ViewName } from "./domain";

const viewNames = new Set<ViewName>([
  "today",
  "program",
  "calendar",
  "exercises",
  "coaching",
]);

export type AppDetailKind = "program" | "workout" | "workout-log";
const appDetailStateKey = "liftLogDetail";

export function parseAppView(hash: string): ViewName {
  const candidate = hash.replace(/^#\/?/, "").split(/[/?]/, 1)[0];
  return viewNames.has(candidate as ViewName)
    ? (candidate as ViewName)
    : "today";
}

export function appViewHash(view: ViewName) {
  return `#/${view}`;
}

export function updateAppViewUrl(
  view: ViewName,
  mode: "push" | "replace" = "push",
) {
  if (typeof window === "undefined") return;
  const nextHash = appViewHash(view);
  if (window.location.hash === nextHash) return;
  const url = new URL(window.location.href);
  url.hash = nextHash;
  if (mode === "replace") window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
}

export function appDetailFromHistory(
  state: unknown = typeof window === "undefined" ? null : window.history.state,
): AppDetailKind | null {
  if (!state || typeof state !== "object") return null;
  const detail = (state as Record<string, unknown>)[appDetailStateKey];
  return detail === "program" || detail === "workout" || detail === "workout-log"
    ? detail
    : null;
}

export function pushAppDetailHistory(
  detail: AppDetailKind,
  view?: ViewName,
) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view) url.hash = appViewHash(view);
  const currentState =
    window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {};
  const nextState = { ...currentState, [appDetailStateKey]: detail };
  if (appDetailFromHistory() !== null) {
    window.history.replaceState(nextState, "", url);
  } else {
    window.history.pushState(nextState, "", url);
  }
}

export function leaveAppDetailHistory() {
  if (typeof window === "undefined" || appDetailFromHistory() === null) {
    return false;
  }
  window.history.back();
  return true;
}
