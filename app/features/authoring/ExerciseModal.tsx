import { useRef, useState } from "react";
import { entryModeForLoggingFormat, loggingFormatFor, trackingFieldsForLoggingFormat, type EntryMode, type Exercise, type ExerciseDiscipline, type ExerciseVideoLink, type LoggingFormat, type TrackingField } from "../../../lib/domain";
import { exerciseVideoLinks, validateExerciseVideoLinks } from "../../../lib/exercise-videos";
import { exerciseCategories, exerciseTrainingStyles, inferredExerciseDiscipline } from "../exercises/exercise-library";
import { AsyncButton, InlineError, ModalShell } from "../../ui-primitives";
import { RecordConfiguration } from "./FormatTrackingFields";

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
    videoLinks: ExerciseVideoLink[],
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
  const [videos, setVideos] = useState(() => exerciseVideoLinks(exercise ?? {}).map((video, key) => ({ ...video, key })));
  const videoKey = useRef(videos.length);
  const hasLegacyCategory = !exerciseCategories.some(
    (candidate) => candidate === category,
  );
  async function save() {
    if (savingRef.current || !name.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim(), discipline, category, entryModeForLoggingFormat(format), trackingFieldsForLoggingFormat(format, trackingFields), cue.trim(), validateExerciseVideoLinks(videos.map(({ url, label }) => ({ url, label }))));
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
        <RecordConfiguration
          format={format}
          value={trackingFields}
          onChange={(nextFormat, fields) => {
            setFormat(nextFormat);
            setTrackingFields(fields);
          }}
        />
        <label className="form-field full">
          <span>Default cue</span>
          <textarea
            value={cue}
            onChange={(event) => setCue(event.target.value)}
            placeholder="Short instruction shown in the workout"
          />
        </label>
        <div className="form-field full exercise-video-editor">
          <span>Videos <em>optional · up to 10</em></span>
          {videos.map((video, index) => <div className="form-grid" key={video.key}>
            <label className="form-field full">
              <span>Video {index + 1} URL</span>
              <input type="url" maxLength={2048} placeholder="https://…" value={video.url}
                onChange={(event) => setVideos((current) => current.map((row) => row.key === video.key ? { ...row, url: event.target.value } : row))} />
            </label>
            <label className="form-field">
              <span>Video {index + 1} label <em>optional</em></span>
              <input maxLength={80} placeholder="e.g. Power clean" value={video.label ?? ""}
                onChange={(event) => setVideos((current) => current.map((row) => row.key === video.key ? { ...row, label: event.target.value } : row))} />
            </label>
            <button type="button" className="button secondary small" aria-label={`Remove video ${index + 1}`}
              onClick={() => setVideos((current) => current.filter((row) => row.key !== video.key))}>Remove video</button>
          </div>)}
          <button type="button" className="button secondary small" disabled={videos.length >= 10}
            onClick={() => { const key = videoKey.current++; setVideos((current) => [...current, { key, url: "" }]); }}>Add video</button>
        </div>
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
