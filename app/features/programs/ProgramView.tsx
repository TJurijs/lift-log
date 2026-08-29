import {
  Activity,
  ArrowLeft,
  CalendarPlus,
  ChevronRight,
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
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState, type ReactNode } from "react";
import type {
  Exercise,
  PlannedWorkout,
  Program,
  WorkoutItem,
} from "../../../lib/domain";
import {
  loggingFormatFor,
  loggingFormatLabel,
} from "../../../lib/domain";
import type { TrainingContentCapabilities } from "../../../lib/capabilities";
import { cn } from "../../../lib/presentation";
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

type ProgramActionKind = "delete" | "publish" | "edit" | "open";

export interface ProgramViewProps {
  program: Program;
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
  onCreateDraft: () => void;
  onBack: () => void;
  onAssignProgram?: () => void;
  onEditWorkout: () => void;
  onSchedule?: () => void;
  renderWorkoutDetails: (workout: PlannedWorkout) => ReactNode;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
}

const programMobileExercisePickerCss = `
.exercise-picker-modal{max-height:min(78dvh,680px);display:grid;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden}
.exercise-picker-modal .modal-heading{margin-bottom:10px}
.exercise-picker-modal .search-field{margin-bottom:10px}
.exercise-picker-modal .picker-results{min-height:0;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;align-content:start;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
.exercise-picker-modal .picker-results::-webkit-scrollbar{display:none}
.exercise-picker-modal .picker-result-row{grid-template-columns:minmax(0,1fr) 30px;border:1px solid var(--line);border-radius:9px}
.exercise-picker-modal .picker-result-main{padding:9px 10px;grid-template-columns:34px minmax(0,1fr) 20px}
.exercise-picker-modal .picker-results strong{font-size:10px}
.exercise-picker-modal .picker-results small{font-size:8px}
.exercise-reorder-row{min-height:28px;display:flex;justify-content:flex-end;align-items:center}
.workout-reorder-toggle{width:auto!important;margin:0!important}
@media(max-width:700px){
  .modal-backdrop:has(.exercise-picker-modal){padding:10px;place-items:end center}
  .exercise-picker-modal .picker-results{min-height:0;grid-template-columns:1fr;grid-auto-rows:minmax(56px,auto);gap:5px;align-content:start;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
  .exercise-picker-modal .picker-result-main{padding:8px 10px;grid-template-columns:34px minmax(0,1fr) 20px}
  .exercise-picker-modal .picker-results strong{font-size:12px}
  .exercise-picker-modal .picker-results small{font-size:10px}
  .exercise-picker-modal .picker-help{display:none}
  .exercise-reorder-row{min-height:34px}
}`;

export default function ProgramView({
  program,
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
  onCreateDraft,
  onBack,
  onAssignProgram,
  onEditWorkout,
  onSchedule,
  renderWorkoutDetails,
  renderWorkoutItem,
}: ProgramViewProps) {
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<Exercise[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reorderingWorkouts, setReorderingWorkouts] = useState(false);
  const [reorderingExercises, setReorderingExercises] = useState(false);
  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const isDraft = program.versionStatus === "draft";
  const isQuickWorkout = program.contentType === "quick_workout";
  const headerTitle = isQuickWorkout
    ? (selectedWorkout?.title ?? program.title)
    : program.title;
  const [title, setTitle] = useState(headerTitle);
  const [description, setDescription] = useState(program.description);
  const canEdit = capabilities.edit;
  const editable = isDraft && capabilities.edit;
  const dragEnabled = editable && !mutationPending;
  const exerciseDragEnabled = dragEnabled && reorderingExercises;
  useEffect(() => {
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
  }, [onSearchExercises, pickerQuery]);
  const workoutItems = selectedWorkout?.sections.flatMap((section) => section.items) ?? [];

  function openExercisePicker() {
    setPickerQuery("");
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

  function finishWorkoutDrag(event: DragEndEvent) {
    if (mutationPending) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = workouts.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onReorderWorkouts(arrayMove(ids, from, to));
  }

  function finishBuilderDrag(event: DragEndEvent) {
    if (mutationPending || !selectedWorkout || !event.over) return;
    const activeData = event.active.data.current;
    const overData = event.over.data.current;
    if (activeData?.type !== "item" || overData?.type !== "item") return;
    const ids = workoutItems.map((item) => item.id);
    const from = ids.indexOf(String(activeData.itemId));
    const to = ids.indexOf(String(overData.itemId));
    if (from >= 0 && to >= 0 && from !== to) onReorderItems(arrayMove(ids, from, to));
  }

  const exercisePickerBody = selectedWorkout?.sections.length ? (
    <>
      <label className="search-field">
        <Search size={16} />
        <input
          aria-label="Search exercises"
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
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
            disabled={!dragEnabled}
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
      {action === "publish" ? "Saving…" : "Save"}
    </button>
  ) : !isDraft && canEdit ? (
    <button
      type="button"
      className="detail-navigation-primary"
      disabled={Boolean(action)}
      onClick={onCreateDraft}
    >
      {action === "edit" ? "Opening…" : "Edit"}
    </button>
  ) : undefined;
  return (
    <>
      <style>{programMobileExercisePickerCss}</style>
      <DetailNavigation
        backLabel={program.athleteId === viewerId ? "Programs" : "Coaching"}
        title={isQuickWorkout ? "Workout" : "Program"}
        onBack={onBack}
        action={mobileSaveAction}
      />
      <PageHeader
        eyebrow={
          program.athleteId === viewerId
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
            All programs
          </button>
          <SourceTag
            presentation={presentProgramProvenance(program, viewerId)}
          />
          <StatusBadge status={isDraft ? "draft" : "ready"} />
          {(onSchedule || onAssignProgram) && (
            <div className="program-editor-secondary-actions">
              {onSchedule && (
                <button className="button secondary small" onClick={onSchedule}>
                  <CalendarPlus size={15} />
                  Schedule
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
              {action === "publish" ? (
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
            !isDraft &&
            canEdit && (
              <button
                className="button primary small program-editor-primary-action desktop-detail-action"
                disabled={Boolean(action)}
                onClick={onCreateDraft}
              >
                {action === "edit" ? (
                  <>
                    <LoaderCircle className="button-spinner" size={15} />
                    Opening…
                  </>
                ) : (
                  <>
                    <Pencil size={15} />
                    {isQuickWorkout ? "Edit workout" : "Edit program"}
                  </>
                )}
              </button>
            )
          )}
        </div>
      </PageHeader>
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
          <aside className="workout-list panel">
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
            <DndContext
              sensors={dragSensors}
              collisionDetection={closestCenter}
              onDragEnd={finishWorkoutDrag}
            >
              <SortableContext
                items={workouts.map((workout) => workout.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="workout-list-items">
                  {workouts.map((workout, index) => (
                    <SortableWorkoutRow
                      key={workout.id}
                      workout={workout}
                      index={index}
                      selected={selectedWorkout?.id === workout.id}
                      editable={dragEnabled && reorderingWorkouts}
                      onSelect={() => onSelectWorkout(workout.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
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
        <DndContext
          sensors={dragSensors}
          collisionDetection={closestCenter}
          onDragEnd={finishBuilderDrag}
        >
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
                {editable ? (
                  <div className="builder-section-list exercise-group-list">
                    {workoutItems.length > 1 && (
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
                    <SortableExerciseList
                      items={workoutItems}
                      editable={editable && !mutationPending}
                      dragEnabled={exerciseDragEnabled}
                      onEditItem={onEditItem}
                      onRemoveItem={onRemoveItem}
                      renderWorkoutItem={renderWorkoutItem}
                    />
                    <button
                      className="button secondary full"
                      type="button"
                      disabled={mutationPending}
                      onClick={openExercisePicker}
                    >
                      <Plus size={15} />
                      Add exercise
                    </button>
                  </div>
                ) : (
                  renderWorkoutDetails(selectedWorkout)
                )}
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
        </DndContext>
      </div>
    </>
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

function SortableWorkoutRow({
  workout,
  index,
  selected,
  editable,
  onSelect,
}: {
  workout: PlannedWorkout;
  index: number;
  selected: boolean;
  editable: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workout.id, disabled: !editable });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "workout-order-row",
        selected && "active",
        isDragging && "dragging",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {editable ? (
        <button
          className="drag-handle"
          type="button"
          aria-label={`Drag ${workout.title} to reorder`}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      ) : (
        <span className="drag-handle-placeholder" aria-hidden />
      )}
      <button className="workout-row-main" onClick={onSelect}>
        <span>{index + 1}</span>
        <div>
          <strong>{workout.title}</strong>
          <small>{workout.durationMinutes} min</small>
        </div>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function SortableExerciseList({
  items,
  editable,
  dragEnabled,
  onEditItem,
  onRemoveItem,
  renderWorkoutItem,
}: {
  items: WorkoutItem[];
  editable: boolean;
  dragEnabled: boolean;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
}) {
  return (
    <SortableContext
      items={items.map((item) => `item:${item.id}`)}
      strategy={verticalListSortingStrategy}
    >
      <div className="builder-item-list">
        {items.length ? (
          items.map((item, index) => (
            <SortableExerciseItem
              key={item.id}
              item={item}
              index={index}
              editable={editable}
              dragEnabled={dragEnabled}
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
    </SortableContext>
  );
}

function SortableExerciseItem({
  item,
  index,
  editable,
  dragEnabled,
  onEdit,
  onRemove,
  renderWorkoutItem,
}: {
  item: WorkoutItem;
  index: number;
  editable: boolean;
  dragEnabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `item:${item.id}`,
    data: { type: "item", itemId: item.id },
    disabled: !dragEnabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "builder-item",
        "builder-exercise-preview",
        dragEnabled && "drag-enabled",
        isDragging && "dragging",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {dragEnabled && (
        <button
          className="drag-handle"
          type="button"
          aria-label={`Drag ${item.title} to reorder`}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      )}
      <div className="builder-exercise-preview-content">
        {renderWorkoutItem(item)}
      </div>
      <div className="builder-exercise-preview-actions">
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
      </div>
      <span className="item-position">{index + 1}</span>
    </div>
  );
}
