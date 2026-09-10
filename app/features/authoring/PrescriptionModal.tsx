import { useState } from "react";
import { Settings2 } from "lucide-react";
import { type EntryMode, type LoggingFormat, type TrackingField, type OwnProfile, type PrescriptionEntry, type WorkoutItem, entryModeForLoggingFormat, loggingFormatFor, trackingFieldsForLoggingFormat, trackingFieldsForMode, workoutItemNotes } from "../../../lib/domain";
import { formatWeight, weightKgValue } from "../../../lib/units";
import { cn } from "../../../lib/presentation";
import { InlineError, ModalShell } from "../../ui-primitives";
import { RecordConfiguration } from "./FormatTrackingFields";
import { DurationInput } from "../active-workout/DurationInput";
import { PlannedRpeSelect, wholeRpe } from "../active-workout/RpeInputs";
const workoutLogFields = (item: Pick<WorkoutItem, "mode" | "fields">) => trackingFieldsForMode(item.mode, item.fields);
type PrescriptionDraftEntry = {
  reps: string;
  load: string;
  rpe: string;
  duration: string;
  distance: string;
  work: string;
  rest: string;
};

type PerEntryField = "reps" | "load" | "rpe" | "duration" | "distance" | "work" | "rest";

function prescriptionDraftEntry(
  entry: PrescriptionEntry | undefined,
  prescription: WorkoutItem["prescription"],
  weightUnit: OwnProfile["weightUnit"],
): PrescriptionDraftEntry {
  return {
    reps: entry?.reps ?? prescription.reps ?? "",
    load:
      (entry?.loadKg ?? prescription.loadKg) !== undefined
        ? formatWeight(entry?.loadKg ?? prescription.loadKg ?? 0, weightUnit)
        : "",
    rpe: wholeRpe(entry?.targetRpe ?? prescription.targetRpe ?? ""),
    duration: String(entry?.durationMinutes ?? prescription.durationMinutes ?? ""),
    distance: (entry?.distance ?? prescription.distance) === undefined ? "" : String(
      (entry?.distance ?? prescription.distance ?? 0) / ((entry?.distanceUnit ?? prescription.distanceUnit) === "m" ? 1000 : 1)),
    work: String(entry?.workSeconds ?? prescription.workSeconds ?? ""),
    rest: String(entry?.restSeconds ?? prescription.restSeconds ?? ""),
  };
}

function prescriptionDraftEntries(
  mode: EntryMode,
  prescription: WorkoutItem["prescription"],
  weightUnit: OwnProfile["weightUnit"],
  format: LoggingFormat,
) {
  const savedEntryCount = prescription.entries?.length || undefined;
  const count =
    mode === "sets"
      ? Math.max(1, prescription.sets ?? savedEntryCount ?? (format === "repetitions" ? 3 : 1))
      : mode === "intervals"
        ? Math.max(1, prescription.rounds ?? savedEntryCount ?? 1)
        : 1;
  const source = prescription.entries?.length
    ? prescription.entries
    : [undefined];
  return Array.from({ length: count }, (_, index) =>
    prescriptionDraftEntry(source[index] ?? source.at(-1), prescription, weightUnit),
  );
}

export default function PrescriptionModal({
  item,
  weightUnit,
  onClose,
  onSave,
}: {
  item: WorkoutItem;
  weightUnit: OwnProfile["weightUnit"];
  onClose: () => void;
  onSave: (item: WorkoutItem) => Promise<void>;
}) {
  const initialFormat = loggingFormatFor(item.mode, item.fields);
  const [format, setFormat] = useState<LoggingFormat>(initialFormat);
  const [trackingFields, setTrackingFields] = useState<TrackingField[]>(() =>
    trackingFieldsForLoggingFormat(initialFormat, workoutLogFields(item)),
  );
  const [entries, setEntries] = useState<PrescriptionDraftEntry[]>(() =>
    prescriptionDraftEntries(item.mode, item.prescription, weightUnit, initialFormat),
  );
  const [perEntry, setPerEntry] = useState<Record<PerEntryField, boolean>>(
    () => Object.fromEntries((Object.keys(entries[0]) as PerEntryField[]).map((field) =>
      [field, entries.some((entry) => entry[field] !== entries[0][field])],
    )) as Record<PerEntryField, boolean>,
  );
  const [note, setNote] = useState(
    workoutItemNotes(item),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const baseMode = entryModeForLoggingFormat(format);
  const mode: EntryMode = baseMode === "result" && (entries.length > 1 || (item.mode === "sets" && format === initialFormat)) ? "sets" : baseMode;
  const entryCount = entries.length;
  const usesPerEntry = (field: PerEntryField) => entryCount > 1 && perEntry[field];
  const entryLabel = mode === "intervals" ? "Per round" : "Per set";
  const metricFields = (["duration", "distance"] as const).filter((field) =>
    trackingFields.includes(field) && (mode !== "intervals" || field === "distance" || entries.some((entry) => entry.duration !== "")),
  );
  const setPlanFields: PerEntryField[] = (["reps", "duration", "distance", "load", "rpe"] as const).filter(
    (field) => trackingFields.includes(field),
  );
  if (perEntry.rest || entries.some((entry) => entry.rest !== "")) setPlanFields.push("rest");
  const intervalPlanFields: PerEntryField[] = ["work", ...metricFields, "rest", ...(trackingFields.includes("rpe") ? ["rpe" as const] : [])];
  const planFields = mode === "intervals" ? intervalPlanFields : setPlanFields;
  const tracks = (field: TrackingField) => trackingFields.includes(field);
  function numberOrUndefined(value: string) {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
  }
  function changeEntryCount(value: string) {
    const count = Math.min(30, Math.max(1, Math.trunc(Number(value) || 1)));
    setEntries((previous) =>
      Array.from({ length: count }, (_, index) =>
        previous[index] ?? previous.at(-1) ?? prescriptionDraftEntry(undefined, item.prescription, weightUnit),
      ),
    );
  }
  function updateEntry(
    index: number,
    field: keyof PrescriptionDraftEntry,
    value: string,
  ) {
    setEntries((previous) =>
      previous.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
  }
  function updateShared(field: PerEntryField, value: string) {
    setPerEntry((previous) => ({ ...previous, [field]: false }));
    setEntries((previous) =>
      previous.map((entry) => ({ ...entry, [field]: value })),
    );
  }
  function togglePerEntry(field: PerEntryField, checked: boolean) {
    setPerEntry((previous) => ({ ...previous, [field]: checked }));
    if (!checked) {
      setEntries((previous) => {
        const sharedValue = previous[0]?.[field] ?? "";
        return previous.map((entry) => ({ ...entry, [field]: sharedValue }));
      });
    }
  }
  function resetForFormat(nextFormat: LoggingFormat, fields: TrackingField[]) {
    if (format === "intervals" && nextFormat === "duration") {
      const converted = entries.map((entry) => ({
        ...entry,
        duration: entry.duration || (entry.work.trim() && Number.isFinite(Number(entry.work))
          ? String(Number(entry.work) / 60) : ""),
      }));
      setEntries(converted);
      setPerEntry((previous) => ({ ...previous, duration: converted.some((entry) => entry.duration !== converted[0]?.duration) }));
    }
    setFormat(nextFormat);
    setTrackingFields(fields);
  }
  async function save() {
    setSaving(true);
    setError("");
    const nextFields = trackingFieldsForLoggingFormat(format, trackingFields);
    if (nextFields.includes("reps") && entries.some((entry) => entry.reps.trim() && !/^\d+(?:\s*[–-]\s*\d+)?$/.test(entry.reps.trim()))) {
      setError("Enter a whole number or range for reps. Describe combinations such as 2 cleans + 1 jerk in Coaching notes.");
      setSaving(false);
      return;
    }
    const savedEntries: PrescriptionEntry[] = entries.map((entry) => ({
      reps: nextFields.includes("reps")
        ? entry.reps.trim() || undefined
        : undefined,
      loadKg: nextFields.includes("load")
        ? numberOrUndefined(weightKgValue(entry.load, weightUnit))
        : undefined,
      durationMinutes:
        nextFields.includes("duration")
          ? numberOrUndefined(entry.duration)
          : undefined,
      distance:
        nextFields.includes("distance")
          ? numberOrUndefined(entry.distance)
          : undefined,
      distanceUnit:
        nextFields.includes("distance") ? "km" : undefined,
      workSeconds:
        mode === "intervals" ? numberOrUndefined(entry.work) : undefined,
      restSeconds: numberOrUndefined(entry.rest),
      targetRpe: nextFields.includes("rpe")
        ? wholeRpe(entry.rpe) || undefined
        : undefined,
    }));
    const firstEntry = savedEntries[0] ?? {};
    const nextItem: WorkoutItem = {
      ...item,
      cue: note.trim(),
      mode,
      fields: nextFields,
      prescription: mode === "none" ? {} : {
        ...firstEntry,
        ...(mode === "sets" ? { sets: entryCount } : mode === "intervals" ? { rounds: entryCount } : {}),
        entries: savedEntries,
      },
    };
    try {
      await onSave(nextItem);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The prescription could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title={`Prescribe ${item.title}`}
      description="Set the target here. Actual results are logged during training."
      onClose={onClose}
      className="prescription-modal"
    >
      <fieldset disabled={saving} className="form-grid prescription-form">
        <RecordConfiguration
          format={format}
          value={trackingFields}
          onChange={resetForFormat}
        />
        {mode !== "none" && <label className="form-field">
          <span>{mode === "intervals" ? "Rounds" : "Sets"}</span>
          <input type="number" min="1" max="30" value={entryCount} onChange={(event) => changeEntryCount(event.target.value)} />
        </label>}
        {metricFields.map((field) => <div className="form-field" key={field}>
          <FieldLabel entryCount={entryCount} label={field === "duration" ? "Time (sec)" : "Distance (km)"}
            optional perEntryLabel={entryLabel} checked={perEntry[field]} onToggle={(checked) => togglePerEntry(field, checked)} />
          {usesPerEntry(field) ? <PerEntryValue label={entryLabel} /> : field === "duration" ?
            <DurationInput aria-label="Target time in seconds" value={entries[0]?.duration ?? ""} onChange={(value) => updateShared("duration", value)} placeholder="Optional" /> :
            <input aria-label="Target distance in kilometres" inputMode="decimal" value={entries[0]?.distance ?? ""} onChange={(event) => updateShared("distance", event.target.value)} placeholder="Optional" />}
        </div>)}
        {tracks("reps") && <div className="form-field">
          <FieldLabel entryCount={entryCount} label="Reps" perEntryLabel={entryLabel}
            checked={perEntry.reps} onToggle={(checked) => togglePerEntry("reps", checked)} />
          {usesPerEntry("reps") ? <PerEntryValue label={entryLabel} /> :
            <input aria-label="Repetitions" value={entries[0]?.reps ?? ""} onChange={(event) => updateShared("reps", event.target.value)} placeholder="5 or 8–10" />}
        </div>}
        {tracks("load") && <div className="form-field">
          <FieldLabel entryCount={entryCount} label={`Weight (${weightUnit})`} optional perEntryLabel={entryLabel}
            checked={perEntry.load} onToggle={(checked) => togglePerEntry("load", checked)} />
          {usesPerEntry("load") ? <PerEntryValue label={entryLabel} /> :
            <input aria-label={`Target weight in ${weightUnit}`} inputMode="decimal" value={entries[0]?.load ?? ""} onChange={(event) => updateShared("load", event.target.value)} placeholder="Optional" />}
        </div>}
        {mode === "intervals" && <div className="form-field">
          <FieldLabel entryCount={entryCount} label="Work (sec)" perEntryLabel={entryLabel}
            checked={perEntry.work} onToggle={(checked) => togglePerEntry("work", checked)} />
          {usesPerEntry("work") ? <PerEntryValue label={entryLabel} /> :
            <input aria-label="Work seconds" inputMode="numeric" value={entries[0]?.work ?? ""} onChange={(event) => updateShared("work", event.target.value)} />}
        </div>}
        {mode !== "none" && <RestTargetControl entryCount={entryCount} entryLabel={entryLabel}
          value={entries[0]?.rest ?? ""} perEntry={perEntry.rest}
          onToggle={(checked) => togglePerEntry("rest", checked)} onChange={(value) => updateShared("rest", value)} />}
        {tracks("rpe") && <div className="form-field planned-rpe-field">
          <FieldLabel entryCount={entryCount} label="Target RPE" optional perEntryLabel={entryLabel}
            checked={perEntry.rpe} onToggle={(checked) => togglePerEntry("rpe", checked)} />
          {usesPerEntry("rpe") ? <PerEntryValue label={entryLabel} /> :
            <PlannedRpeSelect value={entries[0]?.rpe ?? ""} onChange={(value) => updateShared("rpe", value)} />}
        </div>}
        {mode !== "none" && planFields.length > 0 && (entryCount > 1 || mode === "intervals") &&
          <PrescriptionEntryTable label={mode === "intervals" ? "Round plan" : "Set plan"}
            rows={entries} weightUnit={weightUnit} fields={planFields} editable={perEntry} onChange={updateEntry} />}
        <label className="form-field full">
          <span>
            Coaching notes <em>optional</em>
          </span>
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Technique cues, tempo, substitutions…"
          />
        </label>
      </fieldset>
      {error && <InlineError>{error}</InlineError>}
      <div className="modal-actions prescription-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={
            saving ||
            ((mode === "sets" || mode === "intervals") && entryCount < 1)
          }
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </ModalShell>
  );
}

function RestTargetControl({ entryCount, entryLabel, value, perEntry, onToggle, onChange }: {
  entryCount: number;
  entryLabel: string;
  value: string;
  perEntry: boolean;
  onToggle: (checked: boolean) => void;
  onChange: (value: string) => void;
}) {
  return <div className="form-field">
    <FieldLabel entryCount={entryCount} label="Rest (sec)" optional perEntryLabel={entryLabel} checked={perEntry} onToggle={onToggle} />
    {entryCount > 1 && perEntry ? <PerEntryValue label={entryLabel} /> :
      <input aria-label="Rest seconds" inputMode="numeric" value={value} placeholder="Optional" onChange={(event) => onChange(event.target.value)} />}
  </div>;
}

function FieldLabel({
  entryCount,
  label,
  optional = false,
  perEntryLabel,
  checked,
  onToggle,
}: {
  entryCount: number;
  label: string;
  optional?: boolean;
  perEntryLabel: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <span className="prescription-field-label">
      <b>{label}</b>
      {optional && <em>optional</em>}
      {entryCount > 1 && <label className="per-entry-toggle">
        <input
          type="checkbox"
          checked={checked}
          aria-label={`${perEntryLabel} values for ${label}`}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <i aria-hidden />
        <small>{perEntryLabel}</small>
      </label>}
    </span>
  );
}

function PerEntryValue({ label }: { label: string }) {
  return (
    <div className="per-entry-value" aria-label={`${label} values are edited below`}>
      <Settings2 size={13} />
      Edit below
    </div>
  );
}

function PrescriptionEntryTable({
  label,
  rows,
  weightUnit,
  fields,
  editable,
  onChange,
}: {
  label: string;
  rows: PrescriptionDraftEntry[];
  weightUnit: OwnProfile["weightUnit"];
  fields: PerEntryField[];
  editable: Record<PerEntryField, boolean>;
  onChange: (index: number, field: keyof PrescriptionDraftEntry, value: string) => void;
}) {
  return (
    <div
      className={cn(
        "prescription-entry-table",
        "full",
        `tracking-${fields.length}`,
      )}
    >
      <div className="prescription-entry-heading">
        <strong>{label}</strong>
      </div>
      <div className="prescription-entry-grid">
        <div className="prescription-entry-row prescription-entry-header">
          <span>#</span>
          {fields.map((field) => (
            <span key={field}>
              {field === "load"
                ? `Load ${weightUnit}`
                : field === "rpe"
                  ? "RPE"
                  : field === "duration" ? "Time sec" : field === "distance" ? "Distance km" : field === "work"
                    ? "Work s"
                    : field === "rest"
                      ? "Rest s"
                      : field[0].toUpperCase() + field.slice(1)}
            </span>
          ))}
        </div>
        {rows.map((row, index) => (
          <div className="prescription-entry-row" key={index}>
            <span>{index + 1}</span>
            {fields.map((field) =>
              field === "rpe" ? (
                <PlannedRpeSelect
                  ariaLabel={`${label}, ${index + 1}, planned RPE`}
                  key={field}
                  disabled={!editable.rpe}
                  value={row.rpe}
                  onChange={(value) => onChange(index, "rpe", value)}
                />
              ) : field === "duration" ? (
                <DurationInput key={field} aria-label={`${label}, ${index + 1}, time in seconds`} disabled={!editable.duration}
                  value={row.duration} onChange={(value) => onChange(index, "duration", value)} placeholder="—" />
              ) : (
                <input
                  aria-label={`${label}, ${index + 1}, ${field === "load" ? `weight in ${weightUnit}` : field}`}
                  key={field}
                  disabled={!editable[field]}
                  inputMode={field === "load" || field === "distance" ? "decimal" : field === "reps" ? "text" : "numeric"}
                  placeholder="—"
                  value={row[field]}
                  onChange={(event) => onChange(index, field, event.target.value)}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
