import { useRef, useState } from "react";
import { entryModeForLoggingFormat, loggingFormatFor, trackingFieldsForLoggingFormat, type EntryMode, type Exercise, type ExerciseDiscipline, type LoggingFormat, type TrackingField } from "../../../lib/domain";
import { exerciseCategories, exerciseTrainingStyles, inferredExerciseDiscipline } from "../exercises/exercise-library";
import { AsyncButton, InlineError, ModalShell } from "../../ui-primitives";
import { FormatTrackingFields } from "./FormatTrackingFields";

export function ExerciseModal({
  exercise,
  onClose,
  onSave,
}: {
  exercise: Exercise | null;
  onClose: () => void;
  onSave: (
    name: string,
    discipline: ExerciseDiscipline,
    category: string,
    mode: EntryMode,
    fields: TrackingField[],
    cue: string,
  ) => Promise<void>;
}) {
  const [name, setName] = useState(exercise?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const [discipline, setDiscipline] = useState<ExerciseDiscipline>(
    exercise ? inferredExerciseDiscipline(exercise) : "gym",
  );
  const [category, setCategory] = useState(exercise?.category ?? "General");
  const initialFormat = exercise
    ? loggingFormatFor(exercise.defaultMode, exercise.defaultFields)
    : "repetitions";
  const [format, setFormat] = useState<LoggingFormat>(initialFormat);
  const [trackingFields, setTrackingFields] = useState<TrackingField[]>(() =>
    exercise
      ? trackingFieldsForLoggingFormat(initialFormat, exercise.defaultFields)
      : trackingFieldsForLoggingFormat(initialFormat),
  );
  const [cue, setCue] = useState(exercise?.cue ?? "");
  const hasLegacyCategory = !exerciseCategories.some(
    (candidate) => candidate === category,
  );
  async function save() {
    if (savingRef.current || !name.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim(), discipline, category, entryModeForLoggingFormat(format), trackingFieldsForLoggingFormat(format, trackingFields), cue.trim());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The exercise could not be saved. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title={exercise ? "Edit exercise" : "Create an exercise"}
      description={
        exercise
          ? "Update the defaults used when you add this exercise to future workouts."
          : "Save it once, then reuse it in any program you build."
      }
      onClose={onClose}
      dismissible={!saving}
    >
      <fieldset className="form-grid authoring-fields" disabled={saving}>
        <label className="form-field full">
          <span>Exercise name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Tall clean + front squat"
          />
        </label>
        <label className="form-field">
          <span>Training style</span>
          <select
            aria-label="Training style"
            value={discipline}
            onChange={(event) =>
              setDiscipline(event.target.value as ExerciseDiscipline)
            }
          >
            {exerciseTrainingStyles.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Category <em>icon and search</em></span>
          <select
            aria-label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {hasLegacyCategory && <option value={category}>{category}</option>}
            {exerciseCategories.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field full">
          <span>Format</span>
          <select
            value={format}
            onChange={(event) => {
              const nextFormat = event.target.value as LoggingFormat;
              setFormat(nextFormat);
              setTrackingFields(trackingFieldsForLoggingFormat(nextFormat));
            }}
          >
            <option value="repetitions">Repetitions</option>
            <option value="duration">Duration</option>
            <option value="distance">Distance</option>
            <option value="intervals">Intervals</option>
            <option value="instructions">Instructions only</option>
          </select>
        </label>
        <FormatTrackingFields
          format={format}
          value={trackingFields}
          onChange={setTrackingFields}
        />
        <label className="form-field full">
          <span>Default cue</span>
          <textarea
            value={cue}
            onChange={(event) => setCue(event.target.value)}
            placeholder="Short instruction shown in the workout"
          />
        </label>
      </fieldset>
      {error && <InlineError>{error}</InlineError>}
      <div className="modal-actions">
        <button className="button secondary" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <AsyncButton
          className="button primary"
          disabled={!name.trim()}
          loading={saving}
          loadingLabel={exercise ? "Saving…" : "Creating…"}
          onClick={() => void save()}
        >
          {exercise ? "Save changes" : "Create exercise"}
        </AsyncButton>
      </div>
    </ModalShell>
  );
}
