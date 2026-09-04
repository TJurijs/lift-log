import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Dumbbell,
  LoaderCircle,
  Search,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AthleteSummary, Program } from "../../../lib/domain";
import { formatDateOnly, localDateOnly } from "../../../lib/date-only";
import {
  generateProgramRunDates,
  programRunDateOrderError,
  suggestProgramTrainingDays,
} from "../../../lib/program-run-schedule";
import { programWorkoutCount, programWorkouts } from "../../../lib/program-tree";
import { InlineError, ModalShell, PersonAvatar } from "../../ui-primitives";

type WizardStep = "training" | "athletes" | "delivery" | "review";

export interface ProgramRunWizardSubmission {
  programId: string;
  athleteIds: string[];
  workoutDates: Array<{ workoutId: string; plannedDate?: string }>;
  idempotencyKey: string;
}

export interface ProgramRunWizardProps {
  mode: "self" | "coach";
  viewerId: string;
  viewerName: string;
  programs: Program[];
  athletes: AthleteSummary[];
  hasMorePrograms?: boolean;
  loadingMorePrograms?: boolean;
  onLoadMorePrograms?: () => void;
  hasMoreAthletes?: boolean;
  loadingMoreAthletes?: boolean;
  onLoadMoreAthletes?: () => void;
  initialProgramId?: string;
  initialAthleteIds?: string[];
  onLoadProgram: (program: Program) => Promise<Program | null>;
  onClose: () => void;
  onCreate: (submission: ProgramRunWizardSubmission) => Promise<void>;
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

function formatShortDate(value: string) {
  return formatDateOnly(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ProgramRunWizard({
  mode,
  viewerId,
  viewerName,
  programs,
  athletes,
  hasMorePrograms = false,
  loadingMorePrograms = false,
  onLoadMorePrograms,
  hasMoreAthletes = false,
  loadingMoreAthletes = false,
  onLoadMoreAthletes,
  initialProgramId,
  initialAthleteIds = [],
  onLoadProgram,
  onClose,
  onCreate,
}: ProgramRunWizardProps) {
  const programLocked = Boolean(initialProgramId);
  const athletesLocked = mode === "self" || initialAthleteIds.length === 1;
  const steps = useMemo<WizardStep[]>(() => {
    const result: WizardStep[] = [];
    if (!programLocked) result.push("training");
    if (mode === "coach" && !athletesLocked) result.push("athletes");
    result.push("delivery", "review");
    return result;
  }, [athletesLocked, mode, programLocked]);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const [programId, setProgramId] = useState(initialProgramId ?? programs[0]?.id ?? "");
  const selectedSummary = programs.find((candidate) => candidate.id === programId);
  const [athleteIds, setAthleteIds] = useState(
    () => new Set(mode === "self" ? [viewerId] : initialAthleteIds),
  );
  const [programQuery, setProgramQuery] = useState("");
  const [athleteQuery, setAthleteQuery] = useState("");
  const selectedProgramKey = selectedSummary
    ? `${selectedSummary.id}:${selectedSummary.versionId}`
    : "";
  const selectedSummaryHasDetails = Boolean(
    selectedSummary &&
      selectedSummary.detailsLoaded !== false &&
      programWorkouts(selectedSummary).length,
  );
  const [programLoad, setProgramLoad] = useState<{
    key: string;
    program: Program | null;
    error: string;
  }>({ key: "", program: null, error: "" });
  const [programLoadAttempt, setProgramLoadAttempt] = useState(0);
  const [delivery, setDelivery] = useState<"scheduled" | "flexible">("scheduled");
  const [startDate, setStartDate] = useState(() => localDateOnly(new Date()));
  const summaryWorkoutCount = selectedSummary ? programWorkoutCount(selectedSummary) : 0;
  const initialFrequency = Math.min(
    3,
    Math.max(1, summaryWorkoutCount || 3),
  );
  const [sessionsPerWeek, setSessionsPerWeek] = useState(initialFrequency);
  const [trainingDays, setTrainingDays] = useState<number[]>(() =>
    suggestProgramTrainingDays(localDateOnly(new Date()), initialFrequency),
  );
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!selectedSummary || selectedSummaryHasDetails) return;
    let active = true;
    void onLoadProgram(selectedSummary)
      .then((next) => {
        if (active) {
          setProgramLoad({
            key: selectedProgramKey,
            program: next,
            error: next ? "" : "This program could not be loaded.",
          });
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setProgramLoad({
            key: selectedProgramKey,
            program: null,
            error:
              loadError instanceof Error
                ? loadError.message
                : "This program could not be loaded.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [
    onLoadProgram,
    selectedProgramKey,
    selectedSummary,
    selectedSummaryHasDetails,
    programLoadAttempt,
  ]);

  const loadedProgram = selectedSummaryHasDetails
    ? (selectedSummary ?? null)
    : programLoad.key === selectedProgramKey
      ? programLoad.program
      : null;
  const loadingProgram = Boolean(
    selectedSummary &&
      !selectedSummaryHasDetails &&
      programLoad.key !== selectedProgramKey,
  );
  const programLoadError =
    programLoad.key === selectedProgramKey ? programLoad.error : "";
  const workouts = useMemo(
    () => (loadedProgram ? programWorkouts(loadedProgram) : []),
    [loadedProgram],
  );
  const generatedDates = useMemo(() => {
    if (delivery === "flexible" || !workouts.length) return [];
    try {
      return generateProgramRunDates(
        workouts.map((workout) => workout.id),
        startDate,
        trainingDays,
      );
    } catch {
      return [];
    }
  }, [delivery, startDate, trainingDays, workouts]);
  const workoutDates = generatedDates.map((entry) => ({
    ...entry,
    plannedDate: dateOverrides[entry.workoutId] ?? entry.plannedDate,
  }));
  const selectedAthletes =
    mode === "self"
      ? [{ id: viewerId, name: viewerName }]
      : athletes
          .filter((athlete) => athleteIds.has(athlete.id))
          .map((athlete) => ({ id: athlete.id, name: athlete.name }));
  const selectedNames = selectedAthletes.map((athlete) => athlete.name);
  const visiblePrograms = programs.filter((candidate) => {
    const query = programQuery.trim().toLocaleLowerCase();
    return !query || `${candidate.title} ${candidate.description}`.toLocaleLowerCase().includes(query);
  });
  const visibleAthletes = athletes.filter((athlete) => {
    const query = athleteQuery.trim().toLocaleLowerCase();
    return !query || athlete.name.toLocaleLowerCase().includes(query);
  });

  function chooseFrequency(nextFrequency: number) {
    setSessionsPerWeek(nextFrequency);
    setTrainingDays(
      startDate ? suggestProgramTrainingDays(startDate, nextFrequency) : [],
    );
    setDateOverrides({});
  }

  function chooseProgram(candidate: Program) {
    const nextFrequency = Math.min(
      3,
      Math.max(1, programWorkoutCount(candidate) || 1),
    );
    setProgramId(candidate.id);
    setSessionsPerWeek(nextFrequency);
    setTrainingDays(
      startDate ? suggestProgramTrainingDays(startDate, nextFrequency) : [],
    );
    setDateOverrides({});
    setError("");
  }

  function toggleTrainingDay(day: number) {
    const selected = trainingDays.includes(day);
    if (selected && trainingDays.length === 1) return;
    const maximumFrequency = Math.min(7, Math.max(1, workouts.length));
    if (!selected && trainingDays.length >= maximumFrequency) return;
    const nextDays = selected
      ? trainingDays.filter((candidate) => candidate !== day)
      : [...trainingDays, day].sort((a, b) => a - b);
    setTrainingDays(nextDays);
    setSessionsPerWeek(nextDays.length);
    setDateOverrides({});
  }

  function toggleAthlete(athleteId: string) {
    setAthleteIds((current) => {
      const next = new Set(current);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });
  }

  function canContinue() {
    if (step === "training") return Boolean(programId);
    if (step === "athletes") return athleteIds.size > 0;
    if (step === "delivery") {
      return Boolean(
        loadedProgram &&
          workouts.length &&
          (delivery === "flexible" || (startDate && trainingDays.length)),
      );
    }
    return true;
  }

  async function submit() {
    if (!programId || !athleteIds.size || !loadedProgram || saving) return;
    const submittedAthleteIds = [...athleteIds];
    const submittedWorkoutDates: Array<{
      workoutId: string;
      plannedDate?: string;
    }> =
      delivery === "scheduled"
        ? workoutDates.map((entry) => ({ ...entry, plannedDate: entry.plannedDate || undefined }))
        : workouts.map((workout) => ({ workoutId: workout.id }));
    const dateOrderError = programRunDateOrderError(
      workouts.map((workout) => ({
        title: workout.title,
        plannedDate: submittedWorkoutDates.find(
          (entry) => entry.workoutId === workout.id,
        )?.plannedDate,
      })),
    );
    if (dateOrderError) {
      setError(dateOrderError);
      return;
    }
    const fingerprint = JSON.stringify({
      programId,
      athleteIds: [...submittedAthleteIds].sort(),
      workoutDates: submittedWorkoutDates,
    });
    if (idempotencyRef.current?.fingerprint !== fingerprint) {
      idempotencyRef.current = { fingerprint, key: createIdempotencyKey() };
    }
    setSaving(true);
    setError("");
    try {
      await onCreate({
        programId,
        athleteIds: submittedAthleteIds,
        workoutDates: submittedWorkoutDates,
        idempotencyKey: idempotencyRef.current.key,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The program could not be assigned.",
      );
      setSaving(false);
    }
  }

  const targetLabel =
    mode === "self"
      ? "yourself"
      : selectedNames.length === 1
        ? selectedNames[0]
        : selectedNames.length > 1
          ? `${selectedNames.length} athletes`
          : "selected athletes";
  const selectedObjectLabel =
    selectedSummary?.contentType === "quick_workout" ? "workout" : "program";
  const finalAction =
    mode === "self"
      ? `${delivery === "scheduled" ? "Start and schedule" : "Start"} ${selectedObjectLabel}`
      : `${delivery === "scheduled" ? "Assign and schedule" : "Assign"} ${selectedObjectLabel}`;

  return (
    <ModalShell
      title={
        mode === "self"
          ? `Start a ${selectedObjectLabel}`
          : selectedNames.length
            ? `Assign to ${targetLabel}`
            : "Assign training"
      }
      description="This creates a separate training plan. Existing and completed training will not be changed."
      onClose={onClose}
      dismissible={!saving}
      className="program-run-wizard"
      wide
    >
      <div className="program-run-progress" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
        <span>{stepIndex + 1} of {steps.length}</span>
        <div aria-hidden="true">
          {steps.map((candidate, index) => (
            <i key={candidate} className={index <= stepIndex ? "active" : ""} />
          ))}
        </div>
      </div>

      <div className="program-run-wizard-body">
        {step === "training" && (
          <section className="program-run-step" aria-labelledby="run-training-heading">
            <div className="program-run-step-heading">
              <Dumbbell size={20} />
              <div>
                <h3 id="run-training-heading">Choose training</h3>
                <p>Select a program or a standalone workout.</p>
              </div>
            </div>
            <label className="search-field program-run-search">
              <Search size={17} />
              <input
                aria-label="Search training"
                placeholder="Search programs and workouts"
                value={programQuery}
                onChange={(event) => setProgramQuery(event.target.value)}
              />
            </label>
            <div className="program-run-choice-list">
              {visiblePrograms.map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  className={candidate.id === programId ? "selected" : ""}
                  onClick={() => chooseProgram(candidate)}
                >
                  <span className="program-run-choice-icon"><Dumbbell size={17} /></span>
                  <span>
                    <strong>{candidate.title}</strong>
                    <small>{programWorkoutCount(candidate)} {programWorkoutCount(candidate) === 1 ? "workout" : "workouts"}</small>
                  </span>
                  {candidate.id === programId ? <Check size={18} /> : <ChevronRight size={18} />}
                </button>
              ))}
              {!visiblePrograms.length && (
                <div className="program-run-empty-state">
                  <Dumbbell size={22} />
                  <strong>
                    {programs.length ? "No matching training" : "No reusable training yet"}
                  </strong>
                  <p>
                    {programs.length
                      ? "Try a different search."
                      : "Create a program or quick workout before assigning it."}
                  </p>
                </div>
              )}
            </div>
            {hasMorePrograms && onLoadMorePrograms && (
              <button
                type="button"
                className="button secondary full program-run-load-more"
                disabled={loadingMorePrograms}
                onClick={onLoadMorePrograms}
              >
                {loadingMorePrograms && <LoaderCircle className="button-spinner" size={15} />}
                {loadingMorePrograms ? "Loading training…" : "Load more training"}
              </button>
            )}
          </section>
        )}

        {step === "athletes" && (
          <section className="program-run-step" aria-labelledby="run-athletes-heading">
            <div className="program-run-step-heading">
              <UserRound size={20} />
              <div>
                <h3 id="run-athletes-heading">Choose athletes</h3>
                <p>You can give the same plan to more than one athlete.</p>
              </div>
            </div>
            {athletes.length > 4 && (
              <label className="search-field program-run-search">
                <Search size={17} />
                <input
                  aria-label="Search athletes"
                  placeholder="Search athletes"
                  value={athleteQuery}
                  onChange={(event) => setAthleteQuery(event.target.value)}
                />
              </label>
            )}
            <div className="program-run-choice-list athlete-choices">
              {visibleAthletes.map((athlete) => (
                <button
                  type="button"
                  key={athlete.id}
                  className={athleteIds.has(athlete.id) ? "selected" : ""}
                  aria-pressed={athleteIds.has(athlete.id)}
                  onClick={() => toggleAthlete(athlete.id)}
                >
                  <PersonAvatar initials={athlete.initials} name={athlete.name} />
                  <span>
                    <strong>{athlete.name}</strong>
                    <small>{athlete.assignedProgramCount ?? athlete.assignedPrograms.length} active</small>
                  </span>
                  {athleteIds.has(athlete.id) && <Check size={18} />}
                </button>
              ))}
              {!visibleAthletes.length && (
                <div className="program-run-empty-state">
                  <UserRound size={22} />
                  <strong>{athletes.length ? "No matching athletes" : "No athletes available"}</strong>
                  <p>{athletes.length ? "Try a different name." : "Accept an athlete’s coaching request before assigning training."}</p>
                </div>
              )}
            </div>
            {hasMoreAthletes && onLoadMoreAthletes && (
              <button
                type="button"
                className="button secondary full program-run-load-more"
                disabled={loadingMoreAthletes}
                onClick={onLoadMoreAthletes}
              >
                {loadingMoreAthletes && <LoaderCircle className="button-spinner" size={15} />}
                {loadingMoreAthletes ? "Loading athletes…" : "Load more athletes"}
              </button>
            )}
          </section>
        )}

        {step === "delivery" && (
          <section className="program-run-step" aria-labelledby="run-delivery-heading">
            <div className="program-run-step-heading">
              <CalendarDays size={20} />
              <div>
                <h3 id="run-delivery-heading">When should it happen?</h3>
                <p>
                  {mode === "self"
                    ? "Schedule everything now, or choose dates later."
                    : "Schedule everything now, or let the athlete choose dates later."}
                </p>
              </div>
            </div>
            <div className="program-run-delivery-options" role="radiogroup" aria-label="Program delivery">
              <button
                type="button"
                role="radio"
                aria-checked={delivery === "scheduled"}
                className={delivery === "scheduled" ? "selected" : ""}
                onClick={() => setDelivery("scheduled")}
              >
                <span>
                  <strong>{mode === "self" ? "Start and schedule" : "Assign and schedule"}</strong>
                  <small>Generate dates for every workout</small>
                </span>
                {delivery === "scheduled" && <Check size={18} />}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={delivery === "flexible"}
                className={delivery === "flexible" ? "selected" : ""}
                onClick={() => setDelivery("flexible")}
              >
                <span>
                  <strong>Set full schedule later</strong>
                  <small>
                    {selectedObjectLabel === "workout"
                      ? "Choose its calendar date when you are ready"
                      : "Keep the workout sequence now and add all dates later"}
                  </small>
                </span>
                {delivery === "flexible" && <Check size={18} />}
              </button>
            </div>
            {delivery === "scheduled" && (
              <div className="program-run-schedule-fields">
                <label className="form-field">
                  <span>Start date</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      setStartDate(nextDate);
                      setTrainingDays(
                        nextDate
                          ? suggestProgramTrainingDays(nextDate, sessionsPerWeek)
                          : [],
                      );
                      setDateOverrides({});
                    }}
                  />
                </label>
                {workouts.length > 1 && (
                  <>
                    <label className="form-field">
                      <span>Sessions per week</span>
                      <select value={sessionsPerWeek} onChange={(event) => chooseFrequency(Number(event.target.value))}>
                        {Array.from({ length: Math.min(7, workouts.length) }, (_, index) => index + 1).map((count) => (
                          <option key={count} value={count}>{count}× per week</option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="program-run-weekdays">
                      <legend>Training days</legend>
                      <div>
                        {weekDays.map((day) => (
                          <button
                            type="button"
                            key={day.value}
                            aria-pressed={trainingDays.includes(day.value)}
                            className={trainingDays.includes(day.value) ? "selected" : ""}
                            onClick={() => toggleTrainingDay(day.value)}
                          >
                            {day.label}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}
              </div>
            )}
            {loadingProgram && <p className="program-run-loading"><LoaderCircle className="button-spinner" size={16} />Loading workouts…</p>}
          </section>
        )}

        {step === "review" && loadedProgram && (
          <section className="program-run-step" aria-labelledby="run-review-heading">
            <div className="program-run-review-heading">
              <div>
                <p className="eyebrow">Review</p>
                <h3 id="run-review-heading">{loadedProgram.title}</h3>
                <p>{workouts.length} {workouts.length === 1 ? "workout" : "workouts"} for {targetLabel}</p>
              </div>
              <span>{delivery === "scheduled" ? "Scheduled" : "Schedule later"}</span>
            </div>
            <div className="program-run-review-list">
              {workouts.map((workout, index) => {
                const generated = workoutDates.find((entry) => entry.workoutId === workout.id);
                return (
                  <article key={workout.id}>
                    <span>{index + 1}</span>
                    <div><strong>{workout.title}</strong><small>~{workout.durationMinutes} min</small></div>
                    {delivery === "scheduled" ? (
                      <label>
                        <span>{generated?.plannedDate ? formatShortDate(generated.plannedDate) : "Schedule later"}</span>
                        <input
                          type="date"
                          aria-label={`Date for ${workout.title}`}
                          value={generated?.plannedDate ?? ""}
                          onChange={(event) => setDateOverrides((current) => ({ ...current, [workout.id]: event.target.value }))}
                        />
                      </label>
                    ) : (
                      <em>Unscheduled</em>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}
        {error && <InlineError>{error}</InlineError>}
        {programLocked && !selectedSummary && (
          <InlineError>This training is no longer available.</InlineError>
        )}
        {programLoadError && (
          <div className="program-run-load-error">
            <InlineError>{programLoadError}</InlineError>
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                setProgramLoad({ key: "", program: null, error: "" });
                setProgramLoadAttempt((current) => current + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <div className="program-run-wizard-actions">
        <button
          type="button"
          className="button secondary"
          disabled={saving}
          onClick={() => {
            setError("");
            if (stepIndex === 0) onClose();
            else setStepIndex((current) => current - 1);
          }}
        >
          {stepIndex === 0 ? "Cancel" : <><ArrowLeft size={16} />Back</>}
        </button>
        {step === "review" ? (
          <button type="button" className="button primary" disabled={saving || !workouts.length} onClick={() => void submit()}>
            {saving ? <><LoaderCircle className="button-spinner" size={16} />Saving…</> : <><Check size={16} />{finalAction}</>}
          </button>
        ) : (
          <button
            type="button"
            className="button primary"
            disabled={!canContinue() || loadingProgram}
            onClick={() => {
              setError("");
              setStepIndex((current) => Math.min(steps.length - 1, current + 1));
            }}
          >
            Continue<ChevronRight size={16} />
          </button>
        )}
      </div>
    </ModalShell>
  );
}
