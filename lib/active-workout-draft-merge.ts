import type { SessionSetValue } from "./domain";
import type { ActiveWorkoutDraftSnapshot } from "./active-workout-draft-storage";

const MISSING = Symbol("missing active-workout draft value");
const SET_FIELDS = ["reps", "load", "rpe"] as const;

type Missing = typeof MISSING;
type Maybe<T> = T | Missing;
type SetField = (typeof SET_FIELDS)[number];

export interface ActiveWorkoutDraftMergeResult {
  snapshot: ActiveWorkoutDraftSnapshot;
  /** `conflicts.length > 0` means the candidate needs user review. */
  conflicts: string[];
}

function hasOwn(record: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function valueAt<T>(record: Record<string, T>, key: string): Maybe<T> {
  return hasOwn(record, key) ? record[key] : MISSING;
}

function samePrimitive(left: Maybe<string>, right: Maybe<string>) {
  return left === right;
}

function mergePrimitive(
  base: Maybe<string>,
  local: Maybe<string>,
  remote: Maybe<string>,
  path: string,
  conflicts: string[],
): Maybe<string> {
  if (samePrimitive(local, base)) return remote;
  if (samePrimitive(remote, base)) return local;
  if (samePrimitive(local, remote)) return local;

  conflicts.push(path);
  return local;
}

function sameSetValue(left: SessionSetValue, right: SessionSetValue) {
  return SET_FIELDS.every((field) => left[field] === right[field]);
}

function sameSetArray(
  left: Maybe<SessionSetValue[]>,
  right: Maybe<SessionSetValue[]>,
) {
  if (left === MISSING || right === MISSING) return left === right;
  return (
    left.length === right.length &&
    left.every((entry, index) => sameSetValue(entry, right[index]))
  );
}

function cloneSetArray(value: Maybe<SessionSetValue[]>) {
  if (value === MISSING) return MISSING;
  return value.map((entry) => ({ ...entry }));
}

function setPath(itemId: string, row: number, field: SetField) {
  return `setLogs[${itemId}][${row}][${field}]`;
}

function resultPath(itemId: string, field: string) {
  return `resultLogs[${itemId}][${field}]`;
}

function mergeSetLogs(
  base: ActiveWorkoutDraftSnapshot["setLogs"],
  local: ActiveWorkoutDraftSnapshot["setLogs"],
  remote: ActiveWorkoutDraftSnapshot["setLogs"],
  conflicts: string[],
) {
  const merged: ActiveWorkoutDraftSnapshot["setLogs"] = {};
  const itemIds = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  for (const itemId of itemIds) {
    const baseEntries = valueAt(base, itemId);
    const localEntries = valueAt(local, itemId);
    const remoteEntries = valueAt(remote, itemId);

    let candidate: Maybe<SessionSetValue[]>;
    if (sameSetArray(localEntries, baseEntries)) {
      candidate = cloneSetArray(remoteEntries);
    } else if (sameSetArray(remoteEntries, baseEntries)) {
      candidate = cloneSetArray(localEntries);
    } else if (sameSetArray(localEntries, remoteEntries)) {
      candidate = cloneSetArray(localEntries);
    } else if (
      baseEntries !== MISSING &&
      localEntries !== MISSING &&
      remoteEntries !== MISSING &&
      baseEntries.length === localEntries.length &&
      baseEntries.length === remoteEntries.length
    ) {
      candidate = localEntries.map((localEntry, row) => {
        const baseEntry = baseEntries[row];
        const remoteEntry = remoteEntries[row];
        const mergedEntry = {} as SessionSetValue;
        for (const field of SET_FIELDS) {
          mergedEntry[field] = mergePrimitive(
            baseEntry[field],
            localEntry[field],
            remoteEntry[field],
            setPath(itemId, row, field),
            conflicts,
          ) as string;
        }
        return mergedEntry;
      });
    } else {
      // A row add/remove is safe only while the other side is unchanged (or
      // both sides made the exact same structural change, handled above).
      conflicts.push(`setLogs[${itemId}]`);
      candidate = cloneSetArray(localEntries);
    }

    if (candidate !== MISSING) merged[itemId] = candidate;
  }

  return merged;
}

function mergeResultLogs(
  base: ActiveWorkoutDraftSnapshot["resultLogs"],
  local: ActiveWorkoutDraftSnapshot["resultLogs"],
  remote: ActiveWorkoutDraftSnapshot["resultLogs"],
  conflicts: string[],
) {
  const merged: ActiveWorkoutDraftSnapshot["resultLogs"] = {};
  const itemIds = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  for (const itemId of itemIds) {
    const baseFields = valueAt(base, itemId);
    const localFields = valueAt(local, itemId);
    const remoteFields = valueAt(remote, itemId);
    const fieldNames = new Set([
      ...(baseFields === MISSING ? [] : Object.keys(baseFields)),
      ...(localFields === MISSING ? [] : Object.keys(localFields)),
      ...(remoteFields === MISSING ? [] : Object.keys(remoteFields)),
    ]);
    const mergedFields: Record<string, string> = {};

    for (const field of fieldNames) {
      const value = mergePrimitive(
        baseFields === MISSING ? MISSING : valueAt(baseFields, field),
        localFields === MISSING ? MISSING : valueAt(localFields, field),
        remoteFields === MISSING ? MISSING : valueAt(remoteFields, field),
        resultPath(itemId, field),
        conflicts,
      );
      if (value !== MISSING) mergedFields[field] = value;
    }

    if (Object.keys(mergedFields).length > 0) merged[itemId] = mergedFields;
  }

  return merged;
}

/**
 * Performs a pure three-way merge of a server base, the locally retained
 * draft, and the latest server snapshot. Exact disagreements favor the local
 * candidate while returning conflict paths for explicit user review.
 */
export function mergeActiveWorkoutDraftSnapshots(
  base: ActiveWorkoutDraftSnapshot,
  local: ActiveWorkoutDraftSnapshot,
  remote: ActiveWorkoutDraftSnapshot,
): ActiveWorkoutDraftMergeResult {
  const conflicts: string[] = [];
  const sessionRpe = mergePrimitive(
    base.sessionRpe,
    local.sessionRpe,
    remote.sessionRpe,
    "sessionRpe",
    conflicts,
  ) as string;
  const sessionNote = mergePrimitive(
    base.sessionNote,
    local.sessionNote,
    remote.sessionNote,
    "sessionNote",
    conflicts,
  ) as string;

  return {
    snapshot: {
      setLogs: mergeSetLogs(base.setLogs, local.setLogs, remote.setLogs, conflicts),
      resultLogs: mergeResultLogs(
        base.resultLogs,
        local.resultLogs,
        remote.resultLogs,
        conflicts,
      ),
      sessionRpe,
      sessionNote,
    },
    conflicts,
  };
}
