import {
  CalendarDays,
  Check,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProgramRunDetail,
  ProgramRunSummary,
  ProgramRunWorkoutDate,
} from "../../../lib/domain";
import { addCalendarDays, formatDateOnly, localDateOnly } from "../../../lib/date-only";
import {
  generateProgramRunDates,
  programRunDateOrderError,
  suggestProgramTrainingDays,
} from "../../../lib/program-run-schedule";
import { InlineError, ModalShell } from "../../ui-primitives";

export interface ProgramRunScheduleWizardProps {
  run: ProgramRunSummary;
  athleteName?: string;
  onLoad: (runId: string) => Promise<ProgramRunDetail | null>;
  onClose: () => void;
  onSave: (dates: ProgramRunWorkoutDate[], idempotencyKey: string) => Promise<void>;
}

const weekDays = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function readableDate(value: string) {
  return formatDateOnly(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function ProgramRunScheduleWizard({
  run,
  athleteName,
  onLoad,
  onClose,
  onSave,
}: ProgramRunScheduleWizardProps) {
  const [loadState, setLoadState] = useState<{
    runId: string;
    detail: ProgramRunDetail | null;
    error: string;
  }>({ runId: "", detail: null, error: "" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [startDate, setStartDate] = useState(() => localDateOnly(new Date()));
  const initialFrequency = Math.min(3, Math.max(1, run.totalWorkouts));
  const [frequency, setFrequency] = useState(initialFrequency);
  const [trainingDays, setTrainingDays] = useState<number[]>(() =>
    suggestProgramTrainingDays(localDateOnly(new Date()), initialFrequency),
  );
  const [dates, setDates] = useState<Record<string, string>>({});
  const idempotencyRef = useRef({ fingerprint: "", key: "" });
  const isQuickWorkout = run.contentType === "quick_workout";

  useEffect(() => {
    let active = true;
    void onLoad(run.id)
      .then((loaded) => {
        if (!active) return;
        setLoadState({
          runId: run.id,
          detail: loaded,
          error: loaded ? "" : "This program run could not be loaded.",
        });
        const futureWorkouts = (loaded?.workouts ?? []).filter(
          (workout) =>
            workout.status === "unscheduled" || workout.status === "scheduled",
        );
        const nextFrequency = Math.min(3, Math.max(1, futureWorkouts.length));
        const today = localDateOnly(new Date());
        setFrequency(nextFrequency);
        setStartDate(today);
        setTrainingDays(suggestProgramTrainingDays(today, nextFrequency));
        setDates(
          Object.fromEntries(
            futureWorkouts.map((workout) => [
              workout.workoutId,
              workout.plannedDate ?? "",
            ]),
          ),
        );
      })
      .catch((loadError: unknown) => {
        if (active) {
          setLoadState({
            runId: run.id,
            detail: null,
            error:
              loadError instanceof Error
                ? loadError.message
                : "This program run could not be loaded.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, onLoad, run.id]);

  const detail = loadState.runId === run.id ? loadState.detail : null;
  const loading = loadState.runId !== run.id;
  const loadError = loadState.runId === run.id ? loadState.error : "";

  const editableWorkouts = useMemo(
    () =>
      detail?.workouts.filter(
        (workout) =>
          workout.status === "unscheduled" || workout.status === "scheduled",
      ) ?? [],
    [detail],
  );

  function generateDates() {
    if (!editableWorkouts.length || !startDate || !trainingDays.length) return;
    setSaveError("");
    setDates((current) => {
      const next = { ...current };
      let cursor = startDate;
      for (const workout of editableWorkouts) {
        const fixedDate = current[workout.workoutId];
        if (fixedDate) {
          if (fixedDate >= cursor) cursor = addCalendarDays(fixedDate, 1);
          continue;
        }
        const [generated] = generateProgramRunDates(
          [workout.workoutId],
          cursor,
          trainingDays,
        );
        next[workout.workoutId] = generated.plannedDate;
        cursor = addCalendarDays(generated.plannedDate, 1);
      }
      return next;
    });
  }

  function toggleDay(day: number) {
    const selected = trainingDays.includes(day);
    if (selected && trainingDays.length === 1) return;
    const maximumFrequency = Math.min(
      7,
      Math.max(1, editableWorkouts.length),
    );
    if (!selected && trainingDays.length >= maximumFrequency) return;
    const nextDays = selected
      ? trainingDays.filter((candidate) => candidate !== day)
      : [...trainingDays, day].sort((left, right) => left - right);
    setTrainingDays(nextDays);
    setFrequency(nextDays.length);
  }

  async function save() {
    if (!detail || saving || !editableWorkouts.length) return;
    setSaveError("");
    const dateOrderError = programRunDateOrderError(
      detail.workouts.map((workout) => ({
        title: workout.title,
        plannedDate:
          workout.status === "unscheduled" || workout.status === "scheduled"
            ? dates[workout.workoutId] || undefined
            : workout.plannedDate,
      })),
    );
    if (dateOrderError) {
      setSaveError(dateOrderError);
      return;
    }
    setSaving(true);
    const submittedDates = editableWorkouts.map((workout) => ({
      workoutId: workout.workoutId,
      plannedDate: dates[workout.workoutId] || undefined,
    }));
    const fingerprint = JSON.stringify(submittedDates);
    if (idempotencyRef.current.fingerprint !== fingerprint) {
      idempotencyRef.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      await onSave(submittedDates, idempotencyRef.current.key);
    } catch (saveError) {
      setSaveError(
        saveError instanceof Error
          ? saveError.message
          : "The workout dates could not be saved.",
      );
      setSaving(false);
    }
  }

  const datedCount = editableWorkouts.filter(
    (workout) => Boolean(dates[workout.workoutId]),
  ).length;
  const undatedCount = editableWorkouts.length - datedCount;
  const quickWorkout = isQuickWorkout ? editableWorkouts[0] : undefined;
  const quickDate = quickWorkout ? dates[quickWorkout.workoutId] ?? "" : "";
  const today = localDateOnly(new Date());
  const tomorrow = addCalendarDays(today, 1);

  return (
    <ModalShell
      title={`Schedule ${run.title}`}
      description={
        athleteName
          ? isQuickWorkout
            ? `Scheduling for ${athleteName}.`
            : `Add or adjust future workout dates for ${athleteName}.`
          : isQuickWorkout
            ? "Choose when this workout happens."
            : "Add or adjust future workout dates."
      }
      onClose={onClose}
      dismissible={!saving}
      className="program-run-schedule-wizard"
      wide={!isQuickWorkout}
    >
      {loading ? (
        <div className="program-run-schedule-loading" role="status">
          <LoaderCircle className="button-spinner" size={22} />
          Loading the workout sequence…
        </div>
      ) : detail && quickWorkout ? (
        <section className="quick-workout-scheduler" aria-label="Choose workout date">
          <div className="quick-workout-date-presets">
            <button
              type="button"
              className={quickDate === today ? "selected" : ""}
              aria-pressed={quickDate === today}
              onClick={() => setDates({ [quickWorkout.workoutId]: today })}
            >
              <strong>Today</strong>
              <small>{readableDate(today)}</small>
            </button>
            <button
              type="button"
              className={quickDate === tomorrow ? "selected" : ""}
              aria-pressed={quickDate === tomorrow}
              onClick={() => setDates({ [quickWorkout.workoutId]: tomorrow })}
            >
              <strong>Tomorrow</strong>
              <small>{readableDate(tomorrow)}</small>
            </button>
          </div>
          <label className="form-field">
            <span>Choose another date</span>
            <input
              type="date"
              aria-label={`Date for ${quickWorkout.title}`}
              value={quickDate}
              onChange={(event) => {
                setSaveError("");
                setDates({ [quickWorkout.workoutId]: event.target.value });
              }}
            />
          </label>
        </section>
      ) : detail && editableWorkouts.length ? (
        <>
          <section className="program-run-generator" aria-label="Date generator">
            <div className="program-run-generator-heading">
              <span><CalendarDays size={18} /></span>
              <div>
                <strong>Generate a schedule</strong>
                <small>Fill empty dates from a rhythm. Existing dates stay unchanged.</small>
              </div>
            </div>
            <div className="program-run-generator-fields">
              <label className="form-field">
                <span>Start date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setStartDate(nextDate);
                    setTrainingDays(
                      nextDate ? suggestProgramTrainingDays(nextDate, frequency) : [],
                    );
                  }}
                />
              </label>
              <label className="form-field">
                <span>Sessions per week</span>
                <select
                  value={frequency}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setFrequency(next);
                    setTrainingDays(
                      startDate ? suggestProgramTrainingDays(startDate, next) : [],
                    );
                  }}
                >
                  {Array.from(
                    { length: Math.min(7, editableWorkouts.length) },
                    (_, index) => index + 1,
                  ).map((count) => (
                    <option key={count} value={count}>{count}× per week</option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="program-run-weekdays">
              <legend>Training days</legend>
              <div>
                {weekDays.map((day) => (
                  <button
                    type="button"
                    key={day.value}
                    aria-pressed={trainingDays.includes(day.value)}
                    className={trainingDays.includes(day.value) ? "selected" : ""}
                    onClick={() => toggleDay(day.value)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <button
              type="button"
              className="button secondary full"
              disabled={!startDate || !trainingDays.length}
              onClick={generateDates}
            >
              <RefreshCw size={15} />
              Generate dates
            </button>
          </section>

          <section className="program-run-date-list" aria-label="Workout dates">
            <div className="program-run-date-heading">
              <div>
                <strong>Workout dates</strong>
                <small>{datedCount} of {editableWorkouts.length} dated</small>
              </div>
              <span>
                {undatedCount
                  ? `${undatedCount} ${undatedCount === 1 ? "needs a date" : "need dates"}`
                  : "All dated"}
              </span>
            </div>
            {editableWorkouts.map((workout) => {
              const date = dates[workout.workoutId] ?? "";
              return (
                <article key={workout.id}>
                  <span>{workout.position + 1}</span>
                  <div>
                    <strong>{workout.title}</strong>
                    <small>
                      {date ? readableDate(date) : "Not on the calendar"}
                      {workout.estimatedMinutes > 0
                        ? ` · ~${workout.estimatedMinutes} min`
                        : ""}
                    </small>
                  </div>
                  <input
                    type="date"
                    aria-label={`Date for ${workout.title}`}
                    value={date}
                    onChange={(event) =>
                      {
                        setSaveError("");
                        setDates((current) => ({
                          ...current,
                          [workout.workoutId]: event.target.value,
                        }));
                      }
                    }
                  />
                </article>
              );
            })}
          </section>
        </>
      ) : detail ? (
        <div className="program-run-schedule-loading">
          <Check size={22} />
          There are no future workouts left to schedule.
        </div>
      ) : null}

      {saveError && <InlineError>{saveError}</InlineError>}
      {loadError && (
        <div className="program-run-schedule-error">
          <InlineError>{loadError}</InlineError>
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              setLoadState({ runId: "", detail: null, error: "" });
              setLoadAttempt((current) => current + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      <div className="program-run-schedule-actions">
        <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={loading || saving || !editableWorkouts.length || (isQuickWorkout && !quickDate)}
          onClick={() => void save()}
        >
          {saving ? (
            <><LoaderCircle className="button-spinner" size={16} />Saving…</>
          ) : (
            <><Check size={16} />{isQuickWorkout ? "Add to calendar" : "Save all dates"}</>
          )}
        </button>
      </div>
    </ModalShell>
  );
}
