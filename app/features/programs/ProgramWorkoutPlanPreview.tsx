import type {
  OwnProfile,
  PlannedWorkout,
  Prescription,
  PrescriptionEntry,
  WorkoutItem,
} from "../../../lib/domain";
import { formatWeight } from "../../../lib/units";
import { formatRecordedDuration } from "../../../lib/duration";
import { workoutItemNotes } from "../../../lib/domain";
import { ExerciseCategoryIcon } from "../../exercise-category-icons";
import { ExerciseVideoLinks } from "../../exercise-video-link";

type WeightUnit = OwnProfile["weightUnit"];

export interface ProgramWorkoutPlanPreviewProps {
  workout: PlannedWorkout;
  weightUnit?: WeightUnit;
  exerciseCategoryForItem?: (item: WorkoutItem) => string | undefined;
}

type EntryField =
  | "reps"
  | "loadKg"
  | "durationMinutes"
  | "distance"
  | "distanceUnit"
  | "workSeconds"
  | "restSeconds"
  | "targetRpe";

const setFields = ["reps", "durationMinutes", "distance", "distanceUnit", "loadKg", "restSeconds", "targetRpe"] as const;
const intervalFields = [
  "workSeconds",
  "restSeconds",
  "durationMinutes",
  "distance",
  "distanceUnit",
  "targetRpe",
] as const;

function effectiveValue(
  entry: PrescriptionEntry,
  prescription: Prescription,
  field: EntryField,
) {
  return entry[field] ?? prescription[field];
}

function expandedEntries(item: WorkoutItem) {
  const source = item.prescription.entries?.length
    ? item.prescription.entries
    : [item.prescription];
  const requestedCount =
    item.mode === "sets"
      ? item.prescription.sets
      : item.mode === "intervals"
        ? item.prescription.rounds
        : undefined;
  const count = Math.max(1, requestedCount ?? source.length);

  return Array.from({ length: count }, (_, index) =>
    source[index] ?? source.at(-1) ?? item.prescription,
  );
}

function fieldVaries(
  entries: PrescriptionEntry[],
  prescription: Prescription,
  field: EntryField,
) {
  const first = effectiveValue(entries[0] ?? {}, prescription, field);
  return entries.slice(1).some(
    (entry) => effectiveValue(entry, prescription, field) !== first,
  );
}

function hasVaryingPlan(item: WorkoutItem, entries: PrescriptionEntry[]) {
  if (entries.length < 2) return false;
  const fields = item.mode === "sets" ? setFields : intervalFields;
  return fields.some((field) => fieldVaries(entries, item.prescription, field));
}

function formatLoad(value: number | undefined, weightUnit: WeightUnit) {
  return value === undefined ? null : `${formatWeight(value, weightUnit)} ${weightUnit}`;
}

function formatDistance(
  value: number | undefined,
  unit: PrescriptionEntry["distanceUnit"] | undefined,
) {
  return value === undefined ? null : `${value} ${unit ?? "m"}`;
}

function uniformValue(
  item: WorkoutItem,
  entries: PrescriptionEntry[],
  field: EntryField,
) {
  if (fieldVaries(entries, item.prescription, field)) return undefined;
  return effectiveValue(entries[0] ?? {}, item.prescription, field);
}

function planSummary(
  item: WorkoutItem,
  entries: PrescriptionEntry[],
  weightUnit: WeightUnit,
) {
  const parts: string[] = [];
  const varying = hasVaryingPlan(item, entries);

  if (item.mode === "sets") {
    const reps = uniformValue(item, entries, "reps");
    const duration = uniformValue(item, entries, "durationMinutes");
    parts.push(
      reps !== undefined && !varying
        ? `${entries.length} × ${reps}`
        : duration !== undefined && !varying
          ? `${entries.length} × ${formatRecordedDuration(Number(duration))}`
        : `${entries.length} ${entries.length === 1 ? "set" : "sets"}`,
    );
    if (varying) parts.push("Per-set plan");
    const load = formatLoad(
      uniformValue(item, entries, "loadKg") as number | undefined,
      weightUnit,
    );
    if (load) parts.push(load);
    if (duration !== undefined && (reps !== undefined || varying)) parts.push(formatRecordedDuration(Number(duration)));
    const distance = uniformDistance(item, entries);
    if (distance) parts.push(distance);
    const rest = uniformValue(item, entries, "restSeconds");
    if (rest !== undefined) parts.push(`${rest}s rest`);
  } else if (item.mode === "intervals") {
    parts.push(`${entries.length} ${entries.length === 1 ? "round" : "rounds"}`);
    const work = uniformValue(item, entries, "workSeconds");
    const rest = uniformValue(item, entries, "restSeconds");
    const duration = uniformValue(item, entries, "durationMinutes");
    const distance = uniformDistance(item, entries);
    if (work !== undefined) parts.push(`${work}s work`);
    if (rest !== undefined) parts.push(`${rest}s rest`);
    if (duration !== undefined) parts.push(formatRecordedDuration(Number(duration)));
    if (distance) parts.push(distance);
    if (varying) parts.push("Per-round plan");
  } else if (item.mode === "result") {
    const duration = uniformValue(item, entries, "durationMinutes");
    const distance = uniformDistance(item, entries);
    const load = formatLoad(uniformValue(item, entries, "loadKg") as number | undefined, weightUnit);
    if (duration !== undefined) parts.push(formatRecordedDuration(Number(duration)));
    if (distance) parts.push(distance);
    if (load) parts.push(load);
    const rest = uniformValue(item, entries, "restSeconds");
    if (rest !== undefined) parts.push(`${rest}s rest`);
  } else {
    parts.push("Instructions only");
  }

  return parts.join(" · ") || "Open plan";
}

function uniformDistance(item: WorkoutItem, entries: PrescriptionEntry[]) {
  return fieldVaries(entries, item.prescription, "distanceUnit") ? null : formatDistance(
    uniformValue(item, entries, "distance") as number | undefined,
    uniformValue(item, entries, "distanceUnit") as PrescriptionEntry["distanceUnit"],
  );
}

function numericRpe(value: string) {
  const matches = value.match(/\d+(?:\.\d+)?/gu);
  if (!matches?.length) return null;
  return Math.max(...matches.map(Number));
}

function rpeTone(value: string) {
  const numeric = numericRpe(value);
  if (numeric === null) return "neutral";
  if (numeric <= 4) return "low";
  if (numeric <= 8) return "balanced";
  return "high";
}

function TargetRpe({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <span className={`program-plan-rpe ${rpeTone(value)}`}>
      <span className="program-plan-visually-hidden">Target </span>
      RPE <strong>{value}</strong>
    </span>
  );
}

type PlanField = Exclude<EntryField, "distanceUnit">;
const columnLabels: Record<PlanField, string> = {
  reps: "Reps", loadKg: "Load", durationMinutes: "Time", distance: "Distance",
  workSeconds: "Work", restSeconds: "Rest", targetRpe: "RPE target",
};

function PlanTable({ item, entries, weightUnit }: {
  item: WorkoutItem;
  entries: PrescriptionEntry[];
  weightUnit: WeightUnit;
}) {
  const rounds = item.mode === "intervals";
  const columns = (rounds ? intervalFields : setFields).filter((field): field is PlanField =>
    field !== "distanceUnit" && entries.some((entry) => effectiveValue(entry, item.prescription, field) !== undefined),
  );
  const label = (field: PlanField) => field === "loadKg" ? `Load (${weightUnit})` : columnLabels[field];
  function content(entry: PrescriptionEntry, field: PlanField) {
    const value = effectiveValue(entry, item.prescription, field);
    if (value === undefined || value === "") return "—";
    if (field === "targetRpe") return <TargetRpe value={String(value)} />;
    if (field === "loadKg") return formatWeight(Number(value), weightUnit);
    if (field === "durationMinutes") return formatRecordedDuration(Number(value));
    if (field === "workSeconds" || field === "restSeconds") return `${value}s`;
    if (field === "distance") return formatDistance(Number(value), effectiveValue(entry, item.prescription, "distanceUnit") as PrescriptionEntry["distanceUnit"]);
    return value;
  }
  return (
    <div className="program-plan-table-wrap">
      <table aria-label={`Per-${rounds ? "round" : "set"} plan for ${item.title}`}
        className={`program-plan-table${rounds ? " program-plan-interval-table" : ""}`}>
        <thead><tr><th scope="col">{rounds ? "Round" : "Set"}</th>
          {columns.map((field) => <th scope="col" key={field}>{label(field)}</th>)}
        </tr></thead>
        <tbody>{entries.map((entry, index) => <tr key={index}>
          <th scope="row">{index + 1}</th>
          {columns.map((field) => <td key={field} data-label={label(field)}>{content(entry, field)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  );
}
function PlanExercise({
  item,
  category,
  weightUnit,
}: {
  item: WorkoutItem;
  category?: string;
  weightUnit: WeightUnit;
}) {
  const entries = expandedEntries(item);
  const varying = hasVaryingPlan(item, entries);
  const uniformRpe = uniformValue(item, entries, "targetRpe");
  const categoryLabel = (category ?? item.category)?.trim() || "General";
  const note = workoutItemNotes(item);

  return (
    <li className="program-plan-exercise">
      <div className="program-plan-heading">
        <span className="exercise-category-icon compact" title={categoryLabel}>
          <ExerciseCategoryIcon category={categoryLabel} size={14} />
          <span className="program-plan-visually-hidden">
            {categoryLabel} exercise
          </span>
        </span>
        <div className="program-plan-title-block">
          <span className="program-plan-title">
            <strong>{item.title}</strong>
            <ExerciseVideoLinks url={item.videoUrl} videoLinks={item.videoLinks} exerciseName={item.title} />
          </span>
          <div className="program-plan-summary">
            <span>{planSummary(item, entries, weightUnit)}</span>
            {!varying && <TargetRpe value={uniformRpe?.toString()} />}
          </div>
        </div>
      </div>
      {note && <p className="program-plan-note">{note}</p>}
      {varying && (item.mode === "sets" || item.mode === "intervals") && (
        <PlanTable item={item} entries={entries} weightUnit={weightUnit} />
      )}
    </li>
  );
}

export function ProgramWorkoutPlanPreview({
  workout,
  weightUnit = "kg",
  exerciseCategoryForItem,
}: ProgramWorkoutPlanPreviewProps) {
  const items = workout.sections.flatMap((section) => section.items);

  return (
    <section
      className="program-workout-plan-preview"
      aria-label={`${workout.title} plan`}
    >
      {items.length ? (
        <ol className="program-plan-list">
          {items.map((item) => (
            <PlanExercise
              key={item.id}
              item={item}
              category={exerciseCategoryForItem?.(item)}
              weightUnit={weightUnit}
            />
          ))}
        </ol>
      ) : (
        <p className="program-plan-empty">No exercises added yet.</p>
      )}
    </section>
  );
}

export default ProgramWorkoutPlanPreview;
