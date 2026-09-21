import { LoaderCircle, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Exercise } from "../../../lib/domain";
import { loggingFormatFor, loggingFormatLabel } from "../../../lib/domain";
import { ExerciseCategoryMark } from "../../exercise-category-icons";
import { ExerciseVideoLinks } from "../../exercise-video-link";
import { ModalShell } from "../../ui-primitives";

export interface WorkoutExercisePickerProps {
  onSearch: (query: string) => Promise<Exercise[]>;
  onSelect: (exercise: Exercise) => void | Promise<void>;
  onCreateCustom?: (name: string) => Promise<void>;
  onClose: () => void;
  pending?: boolean;
}

export default function WorkoutExercisePicker({
  onSearch,
  onSelect,
  onCreateCustom,
  onClose,
  pending = false,
}: WorkoutExercisePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const addLock = useRef(false);
  const name = query.trim();
  const busy = pending || adding;

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void onSearch(query)
        .then((exercises) => {
          if (current) setResults(exercises.slice(0, 20));
        })
        .catch((error: unknown) => {
          if (current) setSearchError(error instanceof Error ? error.message : "Could not search exercises.");
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [onSearch, query]);

  async function add(action: () => void | Promise<void>) {
    if (pending || addLock.current) return;
    addLock.current = true;
    setAdding(true);
    setAddError("");
    try {
      await action();
      onClose();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not add the exercise.");
    } finally {
      addLock.current = false;
      setAdding(false);
    }
  }

  return (
    <ModalShell title="Add exercise" onClose={onClose} dismissible={!busy} className="program-exercise-picker-modal">
      <form onSubmit={(event) => {
        event.preventDefault();
        if (name && onCreateCustom) void add(() => onCreateCustom(name));
      }}>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search exercises"
            placeholder="Search or add exercise"
            value={query}
            maxLength={160}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setLoading(true);
              setSearchError("");
              setAddError("");
            }}
          />
        </label>
        <div className="picker-results">
          {name && onCreateCustom && (
            <div className="picker-result-row">
              <button type="submit" className="picker-result-main" disabled={busy} aria-label={`Add ${name} to this workout`}>
                {adding ? <LoaderCircle size={18} className="button-spinner" /> : <Plus size={18} />}
                <div><strong>Add “{name}”</strong><small>This workout only</small></div>
              </button>
            </div>
          )}
          {addError && <div className="empty-inline" role="alert">{addError}</div>}
          {searchError && <div className="empty-inline" role="alert">{searchError}</div>}
          {loading && <div className="empty-inline" role="status"><LoaderCircle size={16} className="button-spinner" /> Searching…</div>}
          {results.map((exercise) => (
            <div className="picker-result-row" key={exercise.id}>
              <button type="button" className="picker-result-main" disabled={busy} onClick={() => void add(() => onSelect(exercise))}>
                <ExerciseCategoryMark category={exercise.category} />
                <div>
                  <strong>{exercise.name}</strong>
                  <small>{exercise.category} · {loggingFormatLabel(loggingFormatFor(exercise.defaultMode, exercise.defaultFields))}</small>
                </div>
                <Plus size={15} />
              </button>
              <ExerciseVideoLinks url={exercise.videoUrl} videoLinks={exercise.videoLinks} exerciseName={exercise.name} />
            </div>
          ))}
          {!loading && !searchError && !results.length && !name && <div className="empty-inline">No exercises found.</div>}
        </div>
      </form>
    </ModalShell>
  );
}
