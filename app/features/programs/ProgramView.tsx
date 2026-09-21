import {
  ChevronRight,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type {
  Exercise,
  PlannedWorkout,
  Program,
  ProgramRunWorkout,
  ProgramRunSummary,
  CoachAgendaEntry,
  WorkoutItem,
} from "../../../lib/domain";
import type { TrainingContentCapabilities } from "../../../lib/capabilities";
import { cn } from "../../../lib/presentation";
import { formatDateOnly } from "../../../lib/date-only";
import { programRunLifecycleLabel } from "../../../lib/program-progress";
import { presentProgramProvenance } from "../../../lib/provenance";
import WorkoutExercisePicker from "../authoring/WorkoutExercisePicker";
import { ObjectActionMenu } from "../../object-action-menu";
import type { ProgramMetadata, ProgramMetadataState } from "./useProgramMetadataDraft";
import { actionUi, destinationLabel, trainingContentUi } from "../../ui-semantics";
const WorkoutIcon = trainingContentUi("quick_workout").icon;
import {
  DetailNavigation,
  InlineError,
  PageHeader,
  SourceTag,
  StatusBadge,
} from "../../ui-primitives";

type ProgramActionKind = "delete" | "save" | "duplicate" | "edit" | "open";

export interface ProgramViewProps {
  program: Program;
  metadata: ProgramMetadataState;
  onMetadataChange: (field: keyof ProgramMetadata, value: string) => void;
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
  onAddExercise: (exercise: Exercise) => void | Promise<void>;
  onCreateCustomExercise?: (name: string) => Promise<void>;
  editing?: boolean;
  onEdit?: () => void;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
  onReorderItems: (ids: string[]) => void;
  onSave: (title: string, description: string) => void;
  onDuplicate?: () => void;
  onBack: () => void;
  backLabel?: string;
  onAssignProgram?: () => void;
  onEndProgram?: () => void;
  onEditWorkout: () => void;
  onSetDates?: () => void;
  onStart?: () => void;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
  /** Complete, run-scoped slot metadata. Unlike coach agenda, this is not a preview. */
  runWorkouts?: ProgramRunWorkout[];
  onOpenRunWorkout?: (workout: ProgramRunWorkout) => void;
  onStartRunWorkout?: (workout: ProgramRunWorkout) => void;
  onOpenRunWorkoutResults?: (workout: ProgramRunWorkout) => void;
  onEditRunWorkout?: (workout: ProgramRunWorkout) => void;
  /** Optional result/RPE enrichment for the selected workout. */
  workoutActivity?: CoachAgendaEntry[];
  onOpenActivity?: (entry: CoachAgendaEntry) => void;
}

export default function ProgramView({
  program,
  metadata,
  onMetadataChange,
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
  onCreateCustomExercise,
  editing = true,
  onEdit,
  onEditItem,
  onRemoveItem,
  onReorderItems,
  onSave,
  onDuplicate,
  onBack,
  backLabel: explicitBackLabel,
  onAssignProgram,
  onEndProgram,
  onEditWorkout,
  onSetDates,
  onStart,
  renderWorkoutItem,
  runWorkouts = [],
  onOpenRunWorkout,
  onStartRunWorkout,
  onOpenRunWorkoutResults,
  onEditRunWorkout,
  workoutActivity = [],
  onOpenActivity,
}: ProgramViewProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reorderingWorkouts, setReorderingWorkouts] = useState(false);
  const [reorderingExercises, setReorderingExercises] = useState(false);
  const isQuickWorkout = program.contentType === "quick_workout";
  const { label: objectLabel, icon: ObjectIcon } = trainingContentUi(program.contentType);
  const ScheduleIcon = actionUi.schedule.icon;
  const backLabel = explicitBackLabel ?? (
    program.programRunId
      ? program.athleteId === viewerId
        ? destinationLabel("training")
        : destinationLabel("coaching")
      : destinationLabel("training")
  );
  const headerTitle = isQuickWorkout
    ? (selectedWorkout?.title ?? program.title)
    : program.title;
  const { title, description } = metadata;
  const editable = capabilities.edit && editing;
  const reorderEnabled = editable && !mutationPending;
  const exerciseReorderEnabled = reorderEnabled && reorderingExercises;
  const runWorkoutByWorkoutId = useMemo(
    () => new Map(runWorkouts.map((workout) => [workout.effectiveWorkoutId ?? workout.workoutId, workout])),
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
  const selectedRunWorkoutCanOpen = Boolean(
    onOpenRunWorkout && selectedRunWorkout &&
    programRun?.athleteId === viewerId &&
    ((selectedRunWorkout.status === "completed" && selectedRunWorkout.sessionId) ||
      (selectedRunWorkout.scheduledWorkoutId && (selectedRunWorkout.status === "scheduled" || selectedRunWorkout.status === "in_progress"))),
  );
  const selectedRunWorkoutCanStart = Boolean(
    onStartRunWorkout && selectedRunWorkout && programRun?.athleteId === viewerId &&
    (programRun.status === "not_started" || programRun.status === "in_progress") &&
    (selectedRunWorkout.status === "unscheduled" || selectedRunWorkout.status === "scheduled" || selectedRunWorkout.status === "in_progress"),
  );
  const startSelectedWorkout = selectedRunWorkoutCanStart && selectedRunWorkout
    ? () => onStartRunWorkout?.(selectedRunWorkout)
    : !programRun && selectedWorkout ? onStart : undefined;
  const canDuplicate = Boolean(capabilities.copyToOwn && onDuplicate);
  const canEditSelectedRunWorkout = Boolean(
    onEditRunWorkout && selectedRunWorkout &&
    selectedRunWorkout.canEdit &&
    (selectedRunWorkout.status === "scheduled" || selectedRunWorkout.status === "unscheduled") &&
    (programRun?.status === "not_started" || programRun?.status === "in_progress"),
  );
  const runContextLabel = programRun
    ? programRun.createdById === programRun.athleteId
      ? programRun.athleteId === viewerId
        ? `Your ${isQuickWorkout ? "workout" : "program"}`
        : `${program.ownerName}'s ${isQuickWorkout ? "workout" : "program"}`
      : `Assigned ${isQuickWorkout ? "workout" : "program"}`
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
  const workoutItems = selectedWorkout?.sections.flatMap((section) => section.items) ?? [];

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

  const detailAction = editable ? (
    <span className="program-save-status" role="status">
      {metadata.status === "saving" ? "Saving…" : metadata.status === "unsaved" ? "Unsaved" : metadata.status === "error" ? "Couldn't save" : "Saved"}
    </span>
  ) : undefined;
  return (
    <>
      <DetailNavigation
        backLabel={backLabel}
        title={objectLabel}
        onBack={onBack}
        action={detailAction}
      />
      <PageHeader
        eyebrow={
          programRun
            ? program.athleteId === viewerId
              ? `${programRun.status === "completed" || programRun.status === "ended" ? "Past" : "Your"} ${isQuickWorkout ? "workout" : "program"}`
              : `Training for ${program.ownerName}`
            : program.athleteId === viewerId
            ? isQuickWorkout
              ? "Your workout"
              : "Your program"
            : `Training for ${program.ownerName}`
        }
        title={
          <>
            <span className="program-editor-heading-icon" aria-hidden="true">
              <ObjectIcon size={24} />
            </span>
            {editable ? (
              <label className="program-editor-title-field">
                <span><Pencil size={12} />Edit {objectLabel.toLowerCase()} name</span>
                <textarea
                  className="program-editor-title-input"
                  aria-label={`${objectLabel} name`}
                  value={title}
                  rows={1}
                  onChange={(event) =>
                    onMetadataChange("title", event.target.value.replace(/[\r\n]+/g, " "))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                />
              </label>
            ) : (
              <h1>{headerTitle}</h1>
            )}
          </>
        }
        description={!editable ? program.description : undefined}
      >
        <div className="program-editor-header-actions">
          {program.sourceType !== "self" && <SourceTag
            presentation={presentProgramProvenance(program, viewerId)}
          />}
          {runStatus && <StatusBadge status={runStatus.status} label={runStatus.label} />}
          {editable ? (
            <div className="program-editor-secondary-actions">
              <button type="button" className="button primary small" disabled={Boolean(action) || mutationPending || metadata.status === "saving" || !title.trim()} onClick={() => onSave(title, description)}>Save</button>
            </div>
          ) : (startSelectedWorkout || onSetDates || onAssignProgram || canDuplicate || onEndProgram || onEdit) && (
            <div className="program-editor-secondary-actions">
              {startSelectedWorkout && (
                <button type="button" className="button primary small" disabled={Boolean(action) || mutationPending} onClick={startSelectedWorkout}>
                  <Play size={15} />{selectedRunWorkout?.status === "in_progress" ? "Resume workout" : "Start workout"}
                </button>
              )}
              {onSetDates && (
                <button className={`button ${startSelectedWorkout ? "secondary" : "primary"} small`} disabled={Boolean(action) || mutationPending} onClick={onSetDates}>
                  <ScheduleIcon size={15} />
                  {programRun?.scheduledWorkouts ? "Change dates" : "Set dates"}
                </button>
              )}
              {capabilities.edit && onEdit && <button type="button" className="button secondary small" disabled={Boolean(action) || mutationPending} onClick={onEdit}><Pencil size={15} />Edit</button>}
              {canDuplicate && (
                <button type="button" className="button secondary small" disabled={Boolean(action) || mutationPending} onClick={onDuplicate}>
                  <RefreshCw size={15} />
                  {action === "duplicate" ? "Preparing…" : "Repeat"}
                </button>
              )}
              {onAssignProgram && (
                <button
                  className="button secondary small"
                  disabled={Boolean(action) || mutationPending}
                  onClick={onAssignProgram}
                >
                  <UserPlus size={15} />
                  Assign to athletes
                </button>
              )}
              {onEndProgram && <ObjectActionMenu title={program.title} actions={[{
                ...actionUi.delete, label: "Remove from training", accessibleLabel: `Remove ${program.title} from training`,
                onClick: onEndProgram, destructive: true, disabled: Boolean(action) || mutationPending,
              }]} />}
            </div>
          )}
        </div>
      </PageHeader>
      {programRun && (
        <section className="program-run-context" aria-label="Training progress">
          <div className="program-run-context-copy">
            <span className="program-run-context-icon" aria-hidden="true">
              <ObjectIcon size={18} />
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
            onChange={(event) => onMetadataChange("description", event.target.value)}
          />
        </label>
      )}
      {editable && metadata.error && <div className="program-metadata-status"><InlineError>{metadata.error} <button type="button" className="text-button" onClick={() => onSave(title, description)}>Try again</button></InlineError></div>}
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
            {editable && (
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
                      {editable && (
                        <button
                          className="icon-button"
                          title="Edit workout details"
                          onClick={onEditWorkout}
                          aria-label={`Edit details for ${selectedWorkout.title}`}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                    {selectedWorkout.durationMinutes !== undefined && <p>{selectedWorkout.durationMinutes} min</p>}
                  </div>
                  <div className="editor-actions">
                    {canEditSelectedRunWorkout && selectedRunWorkout && (
                      <button type="button" className="button secondary small"
                        disabled={Boolean(action) || mutationPending}
                        onClick={() => onEditRunWorkout?.(selectedRunWorkout)}
                        aria-label={`Edit ${selectedWorkout.title}`}>
                        <Pencil size={15} />Edit workout
                      </button>
                    )}
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
                              : selectedRunWorkout.status === "completed" && selectedRunWorkout.sessionId && onOpenRunWorkoutResults
                                ? () => onOpenRunWorkoutResults(selectedRunWorkout)
                              : selectedRunWorkoutCanOpen && onOpenRunWorkout
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
                        onClick={() => setPickerOpen(true)}
                      >
                        <Plus size={15} />
                        Add exercise
                      </button>
                    )}
                  </div>
              </>
            ) : (
              <div className="empty-state">
                <WorkoutIcon size={28} />
                <h3>Select a workout</h3>
                <p>Choose a session to view its exercises.</p>
              </div>
          )}
        </section>
        {editable && pickerOpen && (
          <WorkoutExercisePicker
            onSearch={onSearchExercises}
            onSelect={onAddExercise}
            onCreateCustom={onCreateCustomExercise}
            onClose={() => setPickerOpen(false)}
            pending={mutationPending}
          />
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
      return "Removed";
    default:
      return "No date";
  }
}

function compactRunWorkoutMeta(workout: ProgramRunWorkout) {
  const status = runWorkoutStatusLabel(workout.status);
  const date = workout.plannedDate
    ? ` ${coachActivityDate(workout.plannedDate)}`
    : "";
  const duration = (workout.estimatedMinutes ?? 0) > 0
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
      <button type="button" className="workout-row-main" aria-pressed={selected}
        aria-label={[index + 1, workout.title, runWorkout ? compactRunWorkoutMeta(runWorkout) : workout.durationMinutes !== undefined ? `${workout.durationMinutes} min` : ""].filter(Boolean).join(" ")}
        onClick={onSelect}>
        <span>{index + 1}</span>
        <div>
          <strong>{workout.title}</strong>
          {(runWorkout || workout.durationMinutes !== undefined) && <small>{runWorkout ? compactRunWorkoutMeta(runWorkout) : `${workout.durationMinutes} min`}</small>}
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
