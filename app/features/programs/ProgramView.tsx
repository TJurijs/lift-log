import {
  Activity,
  ArrowLeft,
  CalendarPlus,
  ChevronRight,
  Copy,
  Dumbbell,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  Exercise,
  PlannedWorkout,
  Program,
  ProgramRunWorkout,
  ProgramRunSummary,
  CoachAgendaEntry,
  WorkoutItem,
} from "../../../lib/domain";
import {
  loggingFormatFor,
  loggingFormatLabel,
} from "../../../lib/domain";
import type { TrainingContentCapabilities } from "../../../lib/capabilities";
import { cn } from "../../../lib/presentation";
import { formatDateOnly } from "../../../lib/date-only";
import { programRunLifecycleLabel } from "../../../lib/program-progress";
import { presentProgramProvenance } from "../../../lib/provenance";
import { ExerciseCategoryMark } from "../../exercise-category-icons";
import { ExerciseVideoLink } from "../../exercise-video-link";
import {
  DetailNavigation,
  ModalShell,
  PageHeader,
  SourceTag,
  StatusBadge,
} from "../../ui-primitives";

type ProgramActionKind = "delete" | "save" | "duplicate" | "edit" | "open";

export interface ProgramViewProps {
  program: Program;
  programRun?: ProgramRunSummary;
  action: ProgramActionKind | null;
  mutationPending: boolean;
  viewerId: string;
  capabilities: TrainingContentCapabilities;
  workouts: PlannedWorkout[];
  selectedWorkout?: PlannedWorkout;
  onSearchExercises: (query: string) => Promise<Exercise[]>;
  onSelectWorkout: (id: string) => void;
  onAddWorkout: () => void;
  onDeleteWorkout: () => void;
  onReorderWorkouts: (ids: string[]) => void;
  onAddExercise: (exercise: Exercise) => void;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
  onReorderItems: (ids: string[]) => void;
  onSave: (title: string, description: string) => void;
  onDuplicate?: () => void;
  onBack: () => void;
  backLabel?: string;
  onAssignProgram?: () => void;
  onEditWorkout: () => void;
  onSchedule?: () => void;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
  /** Complete, run-scoped slot metadata. Unlike coach agenda, this is not a preview. */
  runWorkouts?: ProgramRunWorkout[];
  onOpenRunWorkout?: (workout: ProgramRunWorkout) => void;
  /** Optional result/RPE enrichment for the selected workout. */
  workoutActivity?: CoachAgendaEntry[];
  onOpenActivity?: (entry: CoachAgendaEntry) => void;
}

export default function ProgramView({
  program,
  programRun,
  action,
  mutationPending,
  viewerId,
  capabilities,
  workouts,
  selectedWorkout,
  onSearchExercises,
  onSelectWorkout,
  onAddWorkout,
  onDeleteWorkout,
  onReorderWorkouts,
  onAddExercise,
  onEditItem,
  onRemoveItem,
  onReorderItems,
  onSave,
  onDuplicate,
  onBack,
  backLabel: explicitBackLabel,
  onAssignProgram,
  onEditWorkout,
  onSchedule,
  renderWorkoutItem,
  runWorkouts = [],
  onOpenRunWorkout,
  workoutActivity = [],
  onOpenActivity,
}: ProgramViewProps) {
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<Exercise[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reorderingWorkouts, setReorderingWorkouts] = useState(false);
  const [reorderingExercises, setReorderingExercises] = useState(false);
  const isEditable = program.versionStatus === "draft";
  const isQuickWorkout = program.contentType === "quick_workout";
  const backLabel = explicitBackLabel ?? (
    program.programRunId
      ? program.athleteId === viewerId
        ? "Next"
        : "Coaching"
      : "Programs"
  );
  const headerTitle = isQuickWorkout
    ? (selectedWorkout?.title ?? program.title)
    : program.title;
  const [title, setTitle] = useState(headerTitle);
  const [description, setDescription] = useState(program.description);
  const editable = isEditable && capabilities.edit;
  const reorderEnabled = editable && !mutationPending;
  const exerciseReorderEnabled = reorderEnabled && reorderingExercises;
  const runWorkoutByWorkoutId = useMemo(
    () => new Map(runWorkouts.map((workout) => [workout.workoutId, workout])),
    [runWorkouts],
  );
  const selectedRunWorkout = selectedWorkout
    ? runWorkoutByWorkoutId.get(selectedWorkout.id)
    : undefined;
  const selectedRunActivity = selectedRunWorkout
    ? workoutActivity.find(
        (entry) =>
          entry.programRunWorkoutId === selectedRunWorkout.id ||
          (!entry.programRunWorkoutId &&
            entry.workoutId === selectedRunWorkout.workoutId),
      )
    : undefined;
  const selectedRunActivityCanOpen = Boolean(
    selectedRunActivity &&
      onOpenActivity &&
      selectedRunActivity.kind === "completed" &&
      selectedRunActivity.sessionId,
  );
  const canDuplicate = Boolean(
    !isEditable && capabilities.copyToOwn && onDuplicate,
  );
  const runContextLabel = programRun
    ? programRun.createdById === programRun.athleteId
      ? programRun.athleteId === viewerId
        ? `Your ${isQuickWorkout ? "workout" : "training plan"}`
        : `${program.ownerName}'s ${isQuickWorkout ? "workout" : "training plan"}`
      : `Assigned ${isQuickWorkout ? "workout" : "plan"}`
    : "";
  const runStatus = programRun
    ? programRun.status === "not_started"
      ? { status: "planned" as const, label: "Not started" }
      : programRun.status === "in_progress"
        ? { status: "in_progress" as const, label: "In progress" }
        : programRun.status === "completed"
          ? {
              status: "completed" as const,
              label: programRunLifecycleLabel(programRun),
            }
          : { status: "locked" as const, label: "Ended" }
    : null;
  useEffect(() => {
    if (!editable || !pickerOpen) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setPickerLoading(true);
      setPickerError("");
      void onSearchExercises(pickerQuery)
        .then((results) => {
          if (active) setPickerResults(results.slice(0, 20));
        })
        .catch((error: unknown) => {
          if (!active) return;
          setPickerError(
            error instanceof Error
              ? error.message
              : "The exercise library could not be searched.",
          );
        })
        .finally(() => {
          if (active) setPickerLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [editable, onSearchExercises, pickerOpen, pickerQuery]);
  const workoutItems = selectedWorkout?.sections.flatMap((section) => section.items) ?? [];
  const selectedWorkoutIndex = workouts.findIndex(
    (workout) => workout.id === selectedWorkout?.id,
  );

  function openExercisePicker() {
    setPickerQuery("");
    setPickerResults([]);
    setPickerError("");
    setPickerLoading(true);
    setPickerOpen(true);
  }

  function closeExercisePicker() {
    setPickerOpen(false);
  }

  function addExerciseFromPicker(exercise: Exercise) {
    if (!selectedWorkout?.sections[0]) return;
    setPickerOpen(false);
    onAddExercise(exercise);
  }

  function moveWorkout(index: number, offset: -1 | 1) {
    if (mutationPending) return;
    const ids = moveItemIds(workouts, index, offset);
    if (ids) onReorderWorkouts(ids);
  }

  function moveExercise(index: number, offset: -1 | 1) {
    if (mutationPending) return;
    const ids = moveItemIds(workoutItems, index, offset);
    if (ids) onReorderItems(ids);
  }

  const exercisePickerBody = selectedWorkout?.sections.length ? (
    <>
      <label className="search-field">
        <Search size={16} />
        <input
          aria-label="Search exercises"
          value={pickerQuery}
          onChange={(event) => {
            setPickerQuery(event.target.value);
            setPickerLoading(true);
            setPickerResults([]);
            setPickerError("");
          }}
          placeholder="Search exercises"
        />
      </label>
      <div className="picker-results">
        {pickerLoading && !pickerResults.length && (
          <div className="empty-inline" role="status">
            <LoaderCircle className="button-spinner" size={16} />
            Searching…
          </div>
        )}
        {pickerError && (
          <div className="empty-inline" role="alert">
            {pickerError}
          </div>
        )}
        {pickerResults.map((exercise) => (
          <ExercisePickerRow
            key={exercise.id}
            exercise={exercise}
            disabled={!reorderEnabled}
            onAdd={() => addExerciseFromPicker(exercise)}
          />
        ))}
        {!pickerLoading && !pickerError && !pickerResults.length && (
          <div className="empty-inline">No matching exercises.</div>
        )}
      </div>
      <small className="picker-help">
        Select an exercise, then prescribe sets, weight or time.
      </small>
    </>
  ) : (
    <div className="empty-inline">This workout is not ready for exercises.</div>
  );
  const mobileSaveAction = editable ? (
    <button
      type="button"
      className="detail-navigation-primary"
      disabled={Boolean(action) || !title.trim()}
      onClick={() => onSave(title, description)}
    >
      {action === "save" ? "Saving…" : "Save"}
    </button>
  ) : canDuplicate ? (
    <button
      type="button"
      className="detail-navigation-primary"
      disabled={Boolean(action)}
      onClick={onDuplicate}
    >
      {action === "duplicate" ? "Duplicating…" : "Duplicate"}
    </button>
  ) : undefined;
  return (
    <>
      <DetailNavigation
        backLabel={backLabel}
        title={isQuickWorkout ? "Workout" : "Program"}
        onBack={onBack}
        action={mobileSaveAction}
      />
      <PageHeader
        eyebrow={
          programRun
            ? program.athleteId === viewerId
              ? `${programRun.status === "completed" || programRun.status === "ended" ? "Past" : "Your"} ${isQuickWorkout ? "workout" : "training plan"}`
              : `Training for ${program.ownerName}`
            : program.athleteId === viewerId
            ? isQuickWorkout
              ? "Your workout"
              : "Your program"
            : `Planning for ${program.ownerName}`
        }
        title={
          <>
            <span className="program-editor-heading-icon" aria-hidden="true">
              {isQuickWorkout ? <Activity size={24} /> : <Layers3 size={24} />}
            </span>
            {editable ? (
              <textarea
                className="program-editor-title-input"
                aria-label={`${isQuickWorkout ? "Workout" : "Program"} name`}
                value={title}
                rows={1}
                onChange={(event) =>
                  setTitle(event.target.value.replace(/[\r\n]+/g, " "))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
              />
            ) : (
              <h1>{headerTitle}</h1>
            )}
          </>
        }
        description={!editable ? program.description : undefined}
      >
        <div className="program-editor-header-actions">
          <button
            className="button secondary small program-editor-back desktop-detail-action"
            onClick={onBack}
          >
            <ArrowLeft size={15} />
            {backLabel}
          </button>
          <SourceTag
            presentation={presentProgramProvenance(program, viewerId)}
          />
          <StatusBadge
            status={runStatus?.status ?? (isEditable ? "editable" : "locked")}
            label={runStatus?.label ?? (isEditable ? "Editable template" : "Saved revision")}
          />
          {(onSchedule || onAssignProgram) && (
            <div className="program-editor-secondary-actions">
              {onSchedule && (
                <button className="button secondary small" onClick={onSchedule}>
                  <CalendarPlus size={15} />
                  {program.sourceType === "self" ? "Start" : "Schedule"}
                </button>
              )}
              {onAssignProgram && (
                <button
                  className="button secondary small"
                  disabled={Boolean(action)}
                  onClick={onAssignProgram}
                >
                  <UserPlus size={15} />
                  Assign to athletes
                </button>
              )}
            </div>
          )}
          {editable ? (
            <button
              className="button primary small program-editor-primary-action desktop-detail-action"
              disabled={Boolean(action) || !title.trim()}
              onClick={() => onSave(title, description)}
            >
              {action === "save" ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  Saving…
                </>
              ) : (
                <>
                  <Save size={15} />
                  {isQuickWorkout ? "Save workout" : "Save program"}
                </>
              )}
            </button>
          ) : (
            canDuplicate && (
              <button
                className="button primary small program-editor-primary-action desktop-detail-action"
                disabled={Boolean(action)}
                onClick={onDuplicate}
              >
                {action === "duplicate" ? (
                  <>
                    <LoaderCircle className="button-spinner" size={15} />
                    Duplicating…
                  </>
                ) : (
                  <>
                    <Copy size={15} />
                    Duplicate
                  </>
                )}
              </button>
            )
          )}
        </div>
      </PageHeader>
      {programRun && (
        <section className="program-run-context" aria-label="Training plan progress">
          <div className="program-run-context-copy">
            <span className="program-run-context-icon" aria-hidden="true">
              {isQuickWorkout ? <Activity size={18} /> : <Layers3 size={18} />}
            </span>
            <div>
              <strong>{runContextLabel}</strong>
              <small>
                Created {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(programRun.createdAt))}
              </small>
            </div>
          </div>
          <div className="program-run-context-progress-copy">
            <strong>
              {programRun.completedWorkouts} of {programRun.totalWorkouts}
            </strong>
            <small>{programRun.totalWorkouts === 1 ? "workout completed" : "workouts completed"}</small>
          </div>
          <div
            className="program-run-context-progress"
            aria-label={`${programRun.completionPercent}% complete`}
          >
            <i
              style={{
                width: `${Math.min(100, Math.max(0, programRun.completionPercent))}%`,
              }}
            />
          </div>
          <small className="program-run-context-scheduled">
            {programRun.scheduledWorkouts} of {programRun.totalWorkouts} have dates
          </small>
        </section>
      )}
      {editable && (
        <label className="form-field program-editor-description-field">
          <span>
            Description <em>optional</em>
          </span>
          <textarea
            value={description}
            placeholder={`What is this ${isQuickWorkout ? "workout" : "program"} for?`}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      )}
      <div
        className={`builder-layout${isQuickWorkout ? " quick-workout-builder" : ""}`}
      >
        {!isQuickWorkout && (
          <aside
            className={cn(
              "workout-list panel",
              reorderingWorkouts && "mobile-reorder-open",
            )}
          >
            <div className="mobile-workout-switcher">
              <label className="form-field">
                <span>
                  {selectedWorkoutIndex >= 0
                    ? `Workout ${selectedWorkoutIndex + 1} of ${workouts.length}`
                    : "Choose a workout"}
                </span>
                <select
                  aria-label="Current workout"
                  value={selectedWorkout?.id ?? ""}
                  disabled={!workouts.length}
                  onChange={(event) => onSelectWorkout(event.target.value)}
                >
                  {!selectedWorkout && <option value="">Choose a workout</option>}
                  {workouts.map((workout, index) => {
                    const runWorkout = runWorkoutByWorkoutId.get(workout.id);
                    return (
                      <option key={workout.id} value={workout.id}>
                        {index + 1}. {workout.title} · {runWorkout
                          ? compactRunWorkoutMeta(runWorkout)
                          : `${workout.durationMinutes} min`}
                      </option>
                    );
                  })}
                </select>
              </label>
              {editable && workouts.length > 1 && (
                <button
                  type="button"
                  className="text-button workout-reorder-toggle"
                  aria-pressed={reorderingWorkouts}
                  onClick={() => setReorderingWorkouts((current) => !current)}
                >
                  {reorderingWorkouts ? "Done" : "Reorder"}
                </button>
              )}
            </div>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Workout sequence</p>
                <h3>{`${workouts.length} ${workouts.length === 1 ? "workout" : "workouts"}`}</h3>
              </div>
              {editable && workouts.length > 1 && (
                <button
                  type="button"
                  className="text-button workout-reorder-toggle"
                  aria-pressed={reorderingWorkouts}
                  onClick={() => setReorderingWorkouts((current) => !current)}
                >
                  {reorderingWorkouts ? "Done" : "Reorder"}
                </button>
              )}
            </div>
            <div className="workout-list-items">
              {workouts.map((workout, index) => (
                <WorkoutOrderRow
                  key={workout.id}
                  workout={workout}
                  runWorkout={runWorkoutByWorkoutId.get(workout.id)}
                  index={index}
                  selected={selectedWorkout?.id === workout.id}
                  reorderEnabled={reorderEnabled && reorderingWorkouts}
                  canMoveUp={index > 0}
                  canMoveDown={index < workouts.length - 1}
                  onMoveUp={() => moveWorkout(index, -1)}
                  onMoveDown={() => moveWorkout(index, 1)}
                  onSelect={() => onSelectWorkout(workout.id)}
                />
              ))}
            </div>
            {!isQuickWorkout && (
              <button
                className="button secondary full"
                disabled={!editable}
                onClick={onAddWorkout}
              >
                <Plus size={15} />
                Add workout
              </button>
            )}
          </aside>
        )}
        <section className="builder-editor panel" aria-busy={mutationPending}>
          {selectedWorkout ? (
              <>
                <div className="editor-heading">
                  <div>
                    <div className="editor-title-row">
                      <h2>{selectedWorkout.title}</h2>
                      {editable && !isQuickWorkout && (
                        <button
                          className="title-edit-button"
                          onClick={onEditWorkout}
                          aria-label="Rename workout"
                          title="Rename workout"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                    <p>Estimated {selectedWorkout.durationMinutes} minutes</p>
                  </div>
                  <div className="editor-actions">
                    {editable && !isQuickWorkout && (
                      <button
                        className="icon-button danger"
                        onClick={onDeleteWorkout}
                        aria-label="Delete workout"
                      >
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                </div>
                {!editable && (selectedRunWorkout || workoutActivity.length > 0) && (
                  <section className="workout-activity" aria-label="Workout status">
                    <div className="workout-activity-heading">
                      <strong>{selectedRunWorkout ? "Workout status" : "Athlete activity"}</strong>
                      {selectedRunWorkout && (
                        <span>{`Workout ${selectedRunWorkout.position + 1} of ${programRun?.totalWorkouts ?? runWorkouts.length}`}</span>
                      )}
                    </div>
                    <div className="workout-activity-list">
                      {selectedRunWorkout ? (
                        <RunWorkoutActivityRow
                          workout={selectedRunWorkout}
                          activity={selectedRunActivity}
                          onOpen={
                            selectedRunActivityCanOpen &&
                            selectedRunActivity &&
                            onOpenActivity
                              ? () => onOpenActivity(selectedRunActivity)
                              : onOpenRunWorkout
                                ? () => onOpenRunWorkout(selectedRunWorkout)
                                : undefined
                          }
                        />
                      ) : workoutActivity.map((entry) => (
                        <button
                          type="button"
                          key={entry.id}
                          disabled={!onOpenActivity || (entry.kind === "completed" && !entry.sessionId)}
                          onClick={() => onOpenActivity?.(entry)}
                        >
                          <span>
                            <strong>{entry.kind === "completed" ? "Completed" : entry.status === "in_progress" ? "In progress" : "Scheduled"}</strong>
                            <small>{coachActivityDate(entry.date)}</small>
                          </span>
                          {entry.kind === "completed" && entry.rpe ? (
                            <span className={cn("workout-activity-rpe", entry.rpe >= 9 ? "high" : entry.rpe >= 5 ? "balanced" : "low")}>RPE {entry.rpe}</span>
                          ) : (
                            <ChevronRight size={15} />
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                <div className="builder-section-list exercise-group-list">
                    {editable && workoutItems.length > 1 && (
                      <div className="exercise-reorder-row">
                        <button
                          className="text-button workout-reorder-toggle"
                          type="button"
                          disabled={mutationPending}
                          aria-pressed={reorderingExercises}
                          onClick={() => setReorderingExercises((value) => !value)}
                        >
                          {reorderingExercises ? "Done" : "Reorder"}
                        </button>
                      </div>
                    )}
                    <ExerciseOrderList
                      items={workoutItems}
                      editable={editable && !mutationPending}
                      reorderEnabled={exerciseReorderEnabled}
                      onMove={moveExercise}
                      onEditItem={onEditItem}
                      onRemoveItem={onRemoveItem}
                      renderWorkoutItem={renderWorkoutItem}
                    />
                    {editable && (
                      <button
                        className="button secondary full"
                        type="button"
                        disabled={mutationPending}
                        onClick={openExercisePicker}
                      >
                        <Plus size={15} />
                        Add exercise
                      </button>
                    )}
                  </div>
              </>
            ) : (
              <div className="empty-state">
                <Dumbbell size={28} />
                <h3>Select a workout</h3>
                <p>Choose a session from the left to start editing.</p>
              </div>
          )}
        </section>
        {editable && pickerOpen && (
          <ModalShell
            title="Add exercise"
            description="Choose an exercise, then set its prescription."
            onClose={closeExercisePicker}
            className="exercise-picker-modal"
          >
            {exercisePickerBody}
          </ModalShell>
        )}
      </div>
    </>
  );
}

function coachActivityDate(value: string) {
  return formatDateOnly(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function runWorkoutStatusLabel(status: ProgramRunWorkout["status"]) {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "skipped":
      return "Skipped";
    case "cancelled":
      return "Cancelled";
    default:
      return "Not scheduled";
  }
}

function compactRunWorkoutMeta(workout: ProgramRunWorkout) {
  const status = runWorkoutStatusLabel(workout.status);
  const date = workout.plannedDate
    ? ` ${coachActivityDate(workout.plannedDate)}`
    : "";
  const duration = workout.estimatedMinutes > 0
    ? ` · ${workout.estimatedMinutes} min`
    : "";
  return `${status}${date}${duration}`;
}

function RunWorkoutActivityRow({
  workout,
  activity,
  onOpen,
}: {
  workout: ProgramRunWorkout;
  activity?: CoachAgendaEntry;
  onOpen?: () => void;
}) {
  const status = activity
    ? activity.kind === "completed"
      ? "Completed"
      : activity.status === "in_progress"
        ? "In progress"
        : activity.status === "overdue"
          ? "Overdue"
          : "Scheduled"
    : runWorkoutStatusLabel(workout.status);
  const date = activity?.date ?? workout.plannedDate;
  return (
    <button type="button" disabled={!onOpen} onClick={onOpen}>
      <span>
        <strong className={cn("run-workout-status", workout.status)}>
          {status}
        </strong>
        <small>{date ? coachActivityDate(date) : "Not on the calendar"}</small>
      </span>
      {activity?.rpe !== undefined ? (
        <span
          className={cn(
            "workout-activity-rpe",
            activity.rpe >= 9
              ? "high"
              : activity.rpe >= 5
                ? "balanced"
                : "low",
          )}
        >
          RPE {activity.rpe}
        </span>
      ) : onOpen ? (
        <ChevronRight size={15} />
      ) : null}
    </button>
  );
}

function ExercisePickerRow({
  exercise,
  disabled,
  onAdd,
}: {
  exercise: Exercise;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="picker-result-row">
      <button
        className="picker-result-main"
        type="button"
        disabled={disabled}
        onClick={onAdd}
      >
        <ExerciseCategoryMark category={exercise.category} />
        <div>
          <strong>{exercise.name}</strong>
          <small>
            {exercise.category} · {loggingFormatLabel(
              loggingFormatFor(exercise.defaultMode, exercise.defaultFields),
            )}
          </small>
        </div>
        <Plus size={15} />
      </button>
      <ExerciseVideoLink
        url={exercise.videoUrl}
        exerciseName={exercise.name}
      />
    </div>
  );
}

function moveItemIds(
  items: Array<{ id: string }>,
  index: number,
  offset: -1 | 1,
) {
  const destination = index + offset;
  if (
    index < 0 ||
    index >= items.length ||
    destination < 0 ||
    destination >= items.length
  ) {
    return null;
  }
  const ids = items.map((item) => item.id);
  const [movedId] = ids.splice(index, 1);
  ids.splice(destination, 0, movedId);
  return ids;
}

function WorkoutOrderRow({
  workout,
  runWorkout,
  index,
  selected,
  reorderEnabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onSelect,
}: {
  workout: PlannedWorkout;
  runWorkout?: ProgramRunWorkout;
  index: number;
  selected: boolean;
  reorderEnabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSelect: () => void;
}) {
  return (
    <div className={cn("workout-order-row", selected && "active")}>
      {reorderEnabled ? (
        <ReorderControls
          label={workout.title}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
      ) : (
        <span className="drag-handle-placeholder" aria-hidden />
      )}
      <button type="button" className="workout-row-main" onClick={onSelect}>
        <span>{index + 1}</span>
        <div>
          <strong>{workout.title}</strong>
          <small>{
            runWorkout
              ? compactRunWorkoutMeta(runWorkout)
              : `${workout.durationMinutes} min`
          }</small>
        </div>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function ExerciseOrderList({
  items,
  editable,
  reorderEnabled,
  onMove,
  onEditItem,
  onRemoveItem,
  renderWorkoutItem,
}: {
  items: WorkoutItem[];
  editable: boolean;
  reorderEnabled: boolean;
  onMove: (index: number, offset: -1 | 1) => void;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
}) {
  return (
    <div className="builder-item-list">
      {items.length ? (
        items.map((item, index) => (
          <ExerciseOrderItem
            key={item.id}
            item={item}
            index={index}
            editable={editable}
            reorderEnabled={reorderEnabled}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
            onMoveUp={() => onMove(index, -1)}
            onMoveDown={() => onMove(index, 1)}
            onEdit={() => onEditItem(item)}
            onRemove={() => onRemoveItem(item.id)}
            renderWorkoutItem={renderWorkoutItem}
          />
        ))
      ) : (
        <div className="empty-inline exercise-drop-empty">
          No exercises yet.
        </div>
      )}
    </div>
  );
}

function ExerciseOrderItem({
  item,
  index,
  editable,
  reorderEnabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onEdit,
  onRemove,
  renderWorkoutItem,
}: {
  item: WorkoutItem;
  index: number;
  editable: boolean;
  reorderEnabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onRemove: () => void;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
}) {
  return (
    <div
      className={cn(
        "builder-item",
        "builder-exercise-preview",
        reorderEnabled && "drag-enabled",
      )}
    >
      {reorderEnabled && (
        <ReorderControls
          label={item.title}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
      )}
      <div className="builder-exercise-preview-content">
        {renderWorkoutItem(item)}
      </div>
      {editable && <div className="builder-exercise-preview-actions">
        <button
          className="icon-button"
          disabled={!editable}
          aria-label={`Edit ${item.title}`}
          title="Edit exercise"
          onClick={onEdit}
        >
          <Pencil size={15} />
        </button>
        <button
          className="icon-button danger"
          disabled={!editable}
          aria-label={`Remove ${item.title}`}
          title="Remove exercise"
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
      </div>}
      <span className="item-position">{index + 1}</span>
    </div>
  );
}

function ReorderControls({
  label,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div
      className="program-reorder-controls"
      role="group"
      aria-label={`Reorder ${label}`}
    >
      <button
        className="drag-handle"
        type="button"
        disabled={!canMoveUp}
        aria-label={`Move ${label} up`}
        title="Move up"
        onClick={onMoveUp}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        className="drag-handle"
        type="button"
        disabled={!canMoveDown}
        aria-label={`Move ${label} down`}
        title="Move down"
        onClick={onMoveDown}
      >
        <span aria-hidden="true">↓</span>
      </button>
    </div>
  );
}
