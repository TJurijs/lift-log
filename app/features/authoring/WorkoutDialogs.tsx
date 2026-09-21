import { useRef, useState } from "react";
import type { PlannedWorkout } from "../../../lib/domain";
import { InlineError, ModalShell } from "../../ui-primitives";

export function WorkoutModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  async function save() {
    if (savingRef.current || !title.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try { await onSave(title.trim()); }
    catch (error) { setError(error instanceof Error ? error.message : "The workout could not be added."); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return (
    <ModalShell
      title="Add a workout"
      onClose={onClose}
      dismissible={!saving}
    >
      <fieldset className="form-grid authoring-fields" disabled={saving}>
        <label className="form-field full">
          <span>Workout name</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Upper body"
          />
        </label>
      </fieldset>
      {error && <InlineError>{error}</InlineError>}
      <div className="modal-actions">
        <button className="button secondary" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!title.trim() || saving}
          onClick={() => void save()}
        >
          {saving ? "Adding…" : "Add workout"}
        </button>
      </div>
    </ModalShell>
  );
}

export function WorkoutSettingsModal({
  workout,
  description,
  onClose,
  onSave,
}: {
  workout: PlannedWorkout;
  description?: string;
  onClose: () => void;
  onSave: (
    title: string,
    durationMinutes: number | undefined,
    description: string,
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(workout.title);
  const [duration, setDuration] = useState(String(workout.durationMinutes ?? ""));
  const [nextDescription, setNextDescription] = useState(description ?? "");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const durationMinutes = duration.trim() ? Number(duration) : undefined;
  const invalidDuration = durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600);
  async function save() {
    if (savingRef.current || !title.trim() || invalidDuration) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(title.trim(), durationMinutes, nextDescription.trim());
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The workout could not be updated.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title="Workout details"
      onClose={onClose}
      dismissible={!saving}
    >
      <fieldset className="form-grid authoring-fields" disabled={saving}>
        <label className="form-field full">
          <span>Workout name</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="form-field full">
          <span>Duration (minutes) <em>optional</em></span>
          <input
            type="number"
            min="1"
            max="600"
            step="1"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        {description !== undefined && (
          <label className="form-field full">
            <span>Description <em>optional</em></span>
            <textarea
              value={nextDescription}
              placeholder="What is this workout for?"
              onChange={(event) => setNextDescription(event.target.value)}
            />
          </label>
        )}
      </fieldset>
      {error && <InlineError>{error}</InlineError>}
      <div className="modal-actions">
        <button className="button secondary" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={
            !title.trim() ||
            invalidDuration ||
            saving
          }
          onClick={save}
        >
          {saving ? "Saving…" : "Save workout"}
        </button>
      </div>
    </ModalShell>
  );
}
