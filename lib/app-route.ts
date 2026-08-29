import type { ViewName } from "./domain";

const viewNames = new Set<ViewName>([
  "today",
  "program",
  "calendar",
  "exercises",
  "coaching",
]);

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

