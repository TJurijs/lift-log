import type {
  OwnProfile,
  PlannedWorkout,
  Prescription,
  PrescriptionEntry,
  WorkoutItem,
} from "../../../lib/domain";
import { formatWeight } from "../../../lib/units";
import { ExerciseCategoryIcon } from "../../exercise-category-icons";
import { ExerciseVideoLink } from "../../exercise-video-link";

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

const setFields = ["reps", "loadKg", "targetRpe"] as const;
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
    parts.push(
      reps !== undefined && !varying
        ? `${entries.length} × ${reps}`
        : `${entries.length} ${entries.length === 1 ? "set" : "sets"}`,
    );
    if (varying) parts.push("Per-set plan");
    const load = formatLoad(
      uniformValue(item, entries, "loadKg") as number | undefined,
      weightUnit,
    );
    if (load) parts.push(load);
  } else if (item.mode === "intervals") {
    parts.push(`${entries.length} ${entries.length === 1 ? "round" : "rounds"}`);
    const work = uniformValue(item, entries, "workSeconds");
    const rest = uniformValue(item, entries, "restSeconds");
    const duration = uniformValue(item, entries, "durationMinutes");
    const distance = formatDistance(
      uniformValue(item, entries, "distance") as number | undefined,
      uniformValue(item, entries, "distanceUnit") as
        | PrescriptionEntry["distanceUnit"]
        | undefined,
    );
    if (work !== undefined) parts.push(`${work}s work`);
    if (rest !== undefined) parts.push(`${rest}s rest`);
    if (duration !== undefined) parts.push(`${duration} min`);
    if (distance) parts.push(distance);
    if (varying) parts.push("Per-round plan");
  } else if (item.mode === "result") {
    const duration = item.prescription.durationMinutes;
    const distance = formatDistance(
      item.prescription.distance,
      item.prescription.distanceUnit,
    );
    const load = formatLoad(item.prescription.loadKg, weightUnit);
    if (duration !== undefined) parts.push(`${duration} min`);
    if (distance) parts.push(distance);
    if (load) parts.push(load);
  } else {
    parts.push("Instructions only");
  }

  return parts.join(" · ") || "Open plan";
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

function cell(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "—" : value;
}

function SetPlanTable({
  item,
  entries,
  weightUnit,
}: {
  item: WorkoutItem;
  entries: PrescriptionEntry[];
  weightUnit: WeightUnit;
}) {
  const showReps = entries.some(
    (entry) => effectiveValue(entry, item.prescription, "reps") !== undefined,
  );
  const showLoad = entries.some(
    (entry) => effectiveValue(entry, item.prescription, "loadKg") !== undefined,
  );
  const showRpe = entries.some(
    (entry) => effectiveValue(entry, item.prescription, "targetRpe") !== undefined,
  );

  return (
    <div className="program-plan-table-wrap">
      <table aria-label={`Per-set plan for ${item.title}`} className="program-plan-table">
        <thead>
          <tr>
            <th scope="col">Set</th>
            {showReps && <th scope="col">Reps</th>}
            {showLoad && <th scope="col">Load ({weightUnit})</th>}
            {showRpe && <th scope="col">RPE target</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const load = effectiveValue(entry, item.prescription, "loadKg");
            return (
              <tr key={index}>
                <th scope="row">{index + 1}</th>
                {showReps && (
                  <td>{cell(effectiveValue(entry, item.prescription, "reps"))}</td>
                )}
                {showLoad && (
                  <td>
                    {cell(
                      typeof load === "number"
                        ? formatWeight(load, weightUnit)
                        : undefined,
                    )}
                  </td>
                )}
                {showRpe && (
                  <td>
                    <TargetRpe
                      value={effectiveValue(
                        entry,
                        item.prescription,
                        "targetRpe",
                      )?.toString()}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IntervalPlanTable({
  item,
  entries,
}: {
  item: WorkoutItem;
  entries: PrescriptionEntry[];
}) {
  const showWork = entries.some(
    (entry) => effectiveValue(entry, item.prescription, "workSeconds") !== undefined,
  );
  const showRest = entries.some(
    (entry) => effectiveValue(entry, item.prescription, "restSeconds") !== undefined,
  );
  const showDuration = entries.some(
    (entry) => effectiveValue(entry, item.prescription, "durationMinutes") !== undefined,
  );
  const showDistance = entries.some(
    (entry) => effectiveValue(entry, item.prescription, "distance") !== undefined,
  );
  const showRpe = entries.some(
    (entry) => effectiveValue(entry, item.prescription, "targetRpe") !== undefined,
  );

  return (
    <div className="program-plan-table-wrap">
      <table
        aria-label={`Per-round plan for ${item.title}`}
        className="program-plan-table program-plan-interval-table"
      >
        <thead>
          <tr>
            <th scope="col">Round</th>
            {showWork && <th scope="col">Work</th>}
            {showRest && <th scope="col">Rest</th>}
            {showDuration && <th scope="col">Time</th>}
            {showDistance && <th scope="col">Distance</th>}
            {showRpe && <th scope="col">RPE target</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const work = effectiveValue(entry, item.prescription, "workSeconds");
            const rest = effectiveValue(entry, item.prescription, "restSeconds");
            const duration = effectiveValue(
              entry,
              item.prescription,
              "durationMinutes",
            );
            const distance = effectiveValue(entry, item.prescription, "distance");
            const distanceUnit = effectiveValue(
              entry,
              item.prescription,
              "distanceUnit",
            );
            const rpe = effectiveValue(entry, item.prescription, "targetRpe");
            return (
              <tr key={index}>
                <th scope="row">{index + 1}</th>
                {showWork && <td data-label="Work">{work === undefined ? "—" : `${work}s`}</td>}
                {showRest && <td data-label="Rest">{rest === undefined ? "—" : `${rest}s`}</td>}
                {showDuration && (
                  <td data-label="Time">{duration === undefined ? "—" : `${duration} min`}</td>
                )}
                {showDistance && (
                  <td data-label="Distance">
                    {formatDistance(
                      distance as number | undefined,
                      distanceUnit as PrescriptionEntry["distanceUnit"] | undefined,
                    ) ?? "—"}
                  </td>
                )}
                {showRpe && <td data-label="RPE target"><TargetRpe value={rpe?.toString()} /></td>}
              </tr>
            );
          })}
        </tbody>
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
  const note = [item.cue, item.prescription.targetText]
    .map((value) => value?.trim())
    .filter((value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index,
    )
    .join(" ");

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
            <ExerciseVideoLink url={item.videoUrl} exerciseName={item.title} />
          </span>
          <div className="program-plan-summary">
            <span>{planSummary(item, entries, weightUnit)}</span>
            {!varying && <TargetRpe value={uniformRpe?.toString()} />}
          </div>
        </div>
      </div>
      {note && <p className="program-plan-note">{note}</p>}
      {varying && item.mode === "sets" && (
        <SetPlanTable item={item} entries={entries} weightUnit={weightUnit} />
      )}
      {varying && item.mode === "intervals" && (
        <IntervalPlanTable item={item} entries={entries} />
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
