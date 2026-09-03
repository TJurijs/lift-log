import type { CompletedSession, ViewName } from "./domain";

const viewNames = new Set<ViewName>([
  "today",
  "program",
  "calendar",
  "exercises",
  "coaching",
]);

export type AppDetailKind =
  | "program"
  | "workout"
  | "workout-log"
  | "coach-athlete";
export type AppDetailData =
  | {
      kind: "program";
      programId: string;
      programVersionId: string;
      athleteId: string;
      assignmentId?: string;
      programRunId?: string;
      workoutId?: string;
      returnView: ViewName;
    }
  | {
      kind: "workout-log";
      session: CompletedSession;
      athleteId?: string;
      returnView: "today" | "calendar" | "coaching" | "program";
    }
  | {
      kind: "coach-athlete";
      athleteId: string;
      tab: "plan" | "history";
    };
const appDetailStateKey = "liftLogDetail";
const appDetailDataStateKey = "liftLogDetailData";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isViewName(value: unknown): value is ViewName {
  return typeof value === "string" && viewNames.has(value as ViewName);
}

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
  return detail === "program" ||
    detail === "workout" ||
    detail === "workout-log" ||
    detail === "coach-athlete"
    ? detail
    : null;
}

export function appDetailDataFromHistory(
  state: unknown = typeof window === "undefined" ? null : window.history.state,
): AppDetailData | null {
  if (!isRecord(state)) return null;
  const value = state[appDetailDataStateKey];
  if (!isRecord(value)) return null;
  if (
    value.kind === "coach-athlete" &&
    typeof value.athleteId === "string" &&
    value.athleteId.length > 0
  ) {
    return {
      kind: "coach-athlete",
      athleteId: value.athleteId,
      tab: value.tab === "history" ? "history" : "plan",
    };
  }
  if (
    value.kind === "program" &&
    typeof value.programId === "string" &&
    value.programId.length > 0 &&
    typeof value.programVersionId === "string" &&
    value.programVersionId.length > 0 &&
    typeof value.athleteId === "string" &&
    value.athleteId.length > 0 &&
    isViewName(value.returnView)
  ) {
    return {
      kind: "program",
      programId: value.programId,
      programVersionId: value.programVersionId,
      athleteId: value.athleteId,
      ...(typeof value.assignmentId === "string"
        ? { assignmentId: value.assignmentId }
        : {}),
      ...(typeof value.programRunId === "string"
        ? { programRunId: value.programRunId }
        : {}),
      ...(typeof value.workoutId === "string"
        ? { workoutId: value.workoutId }
        : {}),
      returnView: value.returnView,
    };
  }
  const session = isRecord(value.session) ? value.session : null;
  if (
    value.kind !== "workout-log" ||
    !session ||
    typeof session.id !== "string" ||
    typeof session.workoutTitle !== "string" ||
    typeof session.date !== "string" ||
    typeof session.durationMinutes !== "number" ||
    typeof session.rpe !== "number" ||
    (value.returnView !== "today" &&
      value.returnView !== "calendar" &&
      value.returnView !== "coaching" &&
      value.returnView !== "program")
  ) {
    return null;
  }
  return {
    kind: "workout-log",
    session: session as unknown as CompletedSession,
    ...(typeof value.athleteId === "string"
      ? { athleteId: value.athleteId }
      : {}),
    returnView: value.returnView,
  };
}

export function pushAppDetailHistory(
  detail: AppDetailKind,
  view?: ViewName,
  options: { stackOnDetail?: boolean; data?: AppDetailData } = {},
) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view) url.hash = appViewHash(view);
  const currentState: Record<string, unknown> =
    window.history.state && typeof window.history.state === "object"
      ? (window.history.state as Record<string, unknown>)
      : {};
  const {
    [appDetailStateKey]: _previousDetail,
    [appDetailDataStateKey]: _previousData,
    ...baseState
  } = currentState;
  void _previousDetail;
  void _previousData;
  const nextState = {
    ...baseState,
    [appDetailStateKey]: detail,
    ...(options.data ? { [appDetailDataStateKey]: options.data } : {}),
  };
  if (appDetailFromHistory() !== null && !options.stackOnDetail) {
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
