import { CalendarDays } from "lucide-react";
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
      description="Create the next session in this program. The athlete chooses its calendar date separately."
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
        <div className="form-info full">
          <CalendarDays size={16} />
          <span>
            This workout is ordered in the plan, not tied to a weekday.
          </span>
        </div>
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
    durationMinutes: number,
    description: string,
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(workout.title);
  const [duration, setDuration] = useState(String(workout.durationMinutes));
  const [nextDescription, setNextDescription] = useState(description ?? "");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const durationMinutes = Number(duration);
  async function save() {
    if (savingRef.current) return;
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
      description="Update the name, description and expected duration shown throughout the plan."
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
          <span>Estimated duration in minutes</span>
          <input
            type="number"
            min="5"
            max="600"
            step="5"
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
            !Number.isInteger(durationMinutes) ||
            durationMinutes < 5 ||
            durationMinutes > 600 ||
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
