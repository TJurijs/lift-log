import { useRef, useState } from "react";
import { InlineError, ModalShell } from "../../ui-primitives";

export function ProgramModal({
  targetName,
  kind = "program",
  onClose,
  onSave,
}: {
  targetName: string;
  kind?: "program" | "workout";
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(title.trim());
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The program could not be created.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title={
        kind === "workout"
          ? "Create a workout"
          : `Create a program for ${targetName}`
      }
      description={
        kind === "workout"
          ? "Create one session, then schedule it for yourself or assign it to athletes."
          : "Add workouts in training order. Choose dates when you use or assign the program."
      }
      onClose={onClose}
      dismissible={!saving}
    >
      <fieldset className="form-grid authoring-fields" disabled={saving}>
        <label className="form-field full">
          <span>{kind === "workout" ? "Workout name" : "Program name"}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              kind === "workout"
                ? "e.g. Friday conditioning"
                : "e.g. Two-day general fitness"
            }
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
          onClick={save}
        >
          {saving ? "Creating…" : kind === "workout" ? "Create workout" : "Create program"}
        </button>
      </div>
    </ModalShell>
  );
}
