import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BicepsFlexed,
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
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
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
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  EntryMode,
  Exercise,
  ExerciseDiscipline,
  PlannedWorkout,
  Program,
  WorkoutItem,
  WorkoutSection,
} from "../../../lib/domain";
import type { TrainingContentCapabilities } from "../../../lib/capabilities";
import { cn } from "../../../lib/presentation";
import { presentProgramProvenance } from "../../../lib/provenance";
import {
  ModalShell,
  PageHeader,
  SourceTag,
  StatusBadge,
} from "../../ui-primitives";

type ProgramActionKind = "delete" | "publish" | "edit" | "open" | "week";

export interface ProgramViewProps {
  program: Program;
  action: ProgramActionKind | null;
  mutationPending: boolean;
  viewerId: string;
  capabilities: TrainingContentCapabilities;
  currentWeek: Program["weeks"][number];
  selectedWeek: number;
  selectedWorkout?: PlannedWorkout;
  selectedSectionId: string;
  onSearchExercises: (query: string) => Promise<Exercise[]>;
  onSelectWeek: (week: number) => void;
  onSelectWorkout: (id: string) => void;
  onSelectSection: (id: string) => void;
  onAddBlankWeek: () => Promise<boolean>;
  onCopyWeek: (count: number) => Promise<boolean>;
  onDeleteWeek: () => void;
  onAddWorkout: () => void;
  onDeleteWorkout: () => void;
  onReorderWorkouts: (ids: string[]) => void;
  onAddSection: () => void;
  onEditSection: (section: WorkoutSection) => void;
  onDeleteSection: (section: WorkoutSection) => void;
  onReorderSections: (ids: string[]) => void;
  onAddExercise: (exercise: Exercise, sectionId?: string) => void;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
  onMoveItem: (
    itemId: string,
    destinationSectionId: string,
    destinationPosition: number,
  ) => void;
  onSave: (title: string, description: string) => void;
  onCreateDraft: () => void;
  onBack: () => void;
  onAssignProgram?: () => void;
  onEditWorkout: () => void;
  onSchedule?: () => void;
  renderWorkoutDetails: (workout: PlannedWorkout) => ReactNode;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
}

function modeLabel(mode: EntryMode) {
  return {
    none: "Instructions",
    sets: "Sets",
    result: "Single result",
    intervals: "Intervals",
  }[mode];
}

function inferredExerciseDiscipline(exercise: Exercise): ExerciseDiscipline {
  if (exercise.discipline) return exercise.discipline;
  if (exercise.category === "Weightlifting") return "weightlifting";
  if (
    ["Functional fitness", "Gymnastics", "Conditioning", "Cardio"].includes(
      exercise.category,
    )
  ) {
    return "functional";
  }
  return "gym";
}

const exerciseTrainingStyles: Array<{
  value: ExerciseDiscipline;
  label: string;
  icon: typeof Activity;
}> = [
  { value: "weightlifting", label: "Weightlifting", icon: Dumbbell },
  { value: "gym", label: "Gym", icon: BicepsFlexed },
  { value: "functional", label: "Functional", icon: Activity },
];

const programMobileExercisePickerCss = `
.section-add-exercise{display:none}
@media(max-width:700px){
  .exercise-drop-empty,.desktop-exercise-picker{display:none}
  .section-add-exercise{width:100%;min-height:48px;margin-top:8px;border:1px dashed var(--line-light);border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;background:transparent;color:var(--text-soft);font-size:12px;font-weight:700;cursor:pointer}
  .section-add-exercise svg{color:var(--accent)}
  .section-add-exercise:focus-visible{border-color:var(--accent);outline:0}
  .modal-backdrop:has(.exercise-picker-modal){padding:10px;place-items:end center}
  .exercise-picker-modal{max-height:min(78dvh,680px);display:grid;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden}
  .exercise-picker-modal .modal-heading{margin-bottom:10px}
  .exercise-picker-modal .picker-results{min-height:0;grid-template-columns:1fr;grid-auto-rows:minmax(56px,auto);gap:5px;align-content:start;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
  .exercise-picker-modal .picker-results::-webkit-scrollbar{display:none}
  .exercise-picker-modal .picker-result-row{grid-template-columns:minmax(0,1fr)}
  .exercise-picker-modal .picker-drag-handle,.exercise-picker-modal .picker-help{display:none}
  .exercise-picker-modal .picker-result-main{padding:8px 10px;grid-template-columns:34px minmax(0,1fr) 20px}
  .exercise-picker-modal .picker-results strong{font-size:12px}
  .exercise-picker-modal .picker-results small{font-size:10px}
}`;

function exerciseTrainingStyleLabel(style: ExerciseDiscipline) {
  return (
    exerciseTrainingStyles.find((item) => item.value === style)?.label ?? "Gym"
  );
}

export default function ProgramView({
  program,
  action,
  mutationPending,
  viewerId,
  capabilities,
  currentWeek,
  selectedWeek,
  selectedWorkout,
  selectedSectionId,
  onSearchExercises,
  onSelectWeek,
  onSelectWorkout,
  onSelectSection,
  onAddBlankWeek,
  onCopyWeek,
  onDeleteWeek,
  onAddWorkout,
  onDeleteWorkout,
  onReorderWorkouts,
  onAddSection,
  onEditSection,
  onDeleteSection,
  onReorderSections,
  onAddExercise,
  onEditItem,
  onRemoveItem,
  onMoveItem,
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
  const [mobilePickerSectionId, setMobilePickerSectionId] = useState<
    string | null
  >(null);
  const [localWeekAction, setLocalWeekAction] = useState<
    "blank" | "copy" | null
  >(null);
  const localWeekActionRef = useRef(false);
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
  const additionalWeekCapacity = Math.max(0, 52 - program.weeks.length);
  const dragEnabled = editable && !mutationPending;
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
  const selectedTargetSection =
    selectedWorkout?.sections.find(
      (section) => section.id === selectedSectionId,
    ) ?? selectedWorkout?.sections[0];
  const pickerTargetSection =
    selectedWorkout?.sections.find(
      (section) => section.id === mobilePickerSectionId,
    ) ?? selectedTargetSection;

  function openMobileExercisePicker(sectionId: string) {
    setPickerQuery("");
    setMobilePickerSectionId(sectionId);
    onSelectSection(sectionId);
  }

  function closeMobileExercisePicker() {
    setMobilePickerSectionId(null);
  }

  function addExerciseFromPicker(exercise: Exercise) {
    const destinationSectionId = pickerTargetSection?.id;
    if (!destinationSectionId) return;
    setMobilePickerSectionId(null);
    onSelectSection(destinationSectionId);
    onAddExercise(exercise, destinationSectionId);
  }

  function finishWorkoutDrag(event: DragEndEvent) {
    if (mutationPending) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = currentWeek.workouts.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onReorderWorkouts(arrayMove(ids, from, to));
  }

  function finishBuilderDrag(event: DragEndEvent) {
    if (mutationPending || !selectedWorkout || !event.over) return;
    const activeData = event.active.data.current;
    const overData = event.over.data.current;
    if (activeData?.type === "library-exercise") {
      const destinationSectionId = String(overData?.sectionId ?? "");
      if (
        !selectedWorkout.sections.some(
          (section) => section.id === destinationSectionId,
        )
      )
        return;
      const exercise = pickerResults.find(
        (candidate) => candidate.id === String(activeData.exerciseId),
      );
      if (!exercise) return;
      onSelectSection(destinationSectionId);
      onAddExercise(exercise, destinationSectionId);
      return;
    }
    if (activeData?.type === "section") {
      const sectionIds = selectedWorkout.sections.map((section) => section.id);
      const targetSectionId = String(overData?.sectionId ?? "");
      const from = sectionIds.indexOf(String(activeData.sectionId));
      const to = sectionIds.indexOf(targetSectionId);
      if (from >= 0 && to >= 0 && from !== to)
        onReorderSections(arrayMove(sectionIds, from, to));
      return;
    }
    if (activeData?.type !== "item") return;
    const destinationSectionId = String(overData?.sectionId ?? "");
    const destinationSection = selectedWorkout.sections.find(
      (section) => section.id === destinationSectionId,
    );
    if (!destinationSection) return;
    const itemId = String(activeData.itemId);
    const sourceSectionId = String(activeData.sectionId);
    const destinationIds = destinationSection.items
      .map((item) => item.id)
      .filter((id) => id !== itemId);
    const overItemId =
      overData?.type === "item" ? String(overData.itemId) : null;
    let destinationPosition = overItemId
      ? destinationIds.indexOf(overItemId)
      : destinationIds.length;
    if (destinationPosition < 0) destinationPosition = destinationIds.length;
    if (sourceSectionId === destinationSectionId) {
      const originalIds = destinationSection.items.map((item) => item.id);
      const from = originalIds.indexOf(itemId);
      const overIndex = overItemId ? originalIds.indexOf(overItemId) : -1;
      if (from >= 0 && overIndex >= 0) destinationPosition = overIndex;
      if (from === destinationPosition) return;
    }
    onMoveItem(itemId, destinationSectionId, destinationPosition);
    onSelectSection(destinationSectionId);
  }

  async function runWeekAction(
    kind: "blank" | "copy",
    mutation: () => Promise<boolean>,
  ) {
    if (localWeekActionRef.current || action) return;
    localWeekActionRef.current = true;
    setLocalWeekAction(kind);
    try {
      await mutation();
    } finally {
      localWeekActionRef.current = false;
      setLocalWeekAction(null);
    }
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
          <DraggableExercisePickerRow
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
        Drag an exercise into any section, or select it to add it to the active
        section. Then prescribe sets, weight or time.
      </small>
    </>
  ) : (
    <div className="empty-inline">Add a workout section first.</div>
  );
  return (
    <>
      <style>{programMobileExercisePickerCss}</style>
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
              <input
                className="program-editor-title-input"
                aria-label={`${isQuickWorkout ? "Workout" : "Program"} name`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
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
            className="button secondary small program-editor-back"
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
              className="button primary small program-editor-primary-action"
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
                className="button primary small program-editor-primary-action"
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
      {!isQuickWorkout && editable && program.weeks.length > 1 && (
        <div className="program-editor-week-delete">
          <button className="button danger small" onClick={onDeleteWeek}>
            <Trash2 size={14} />
            Delete week {selectedWeek}
          </button>
        </div>
      )}
      {!isQuickWorkout && (
        <div className="week-tabs">
          <button
            className="icon-button"
            aria-label="Previous program week"
            onClick={() => onSelectWeek(Math.max(1, selectedWeek - 1))}
            disabled={selectedWeek === 1}
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            {program.weeks.map((week) => (
              <button
                key={week.index}
                className={selectedWeek === week.index ? "active" : ""}
                onClick={() => onSelectWeek(week.index)}
              >
                <small>Week</small>
                <strong>{week.index}</strong>
              </button>
            ))}
            {editable && (
              <>
                <button
                  className="week-add"
                  disabled={Boolean(action) || additionalWeekCapacity === 0}
                  onClick={() => void runWeekAction("blank", onAddBlankWeek)}
                  title="Add blank week"
                  aria-label="Add blank week"
                >
                  {localWeekAction === "blank" ? (
                    <LoaderCircle className="button-spinner" size={17} />
                  ) : (
                    <Plus size={18} />
                  )}
                </button>
                <button
                  className="week-add"
                  disabled={
                    !currentWeek.workouts.length ||
                    Boolean(action) ||
                    additionalWeekCapacity === 0
                  }
                  onClick={() =>
                    void runWeekAction("copy", () => onCopyWeek(1))
                  }
                  title={`Duplicate Week ${selectedWeek}`}
                  aria-label={`Duplicate Week ${selectedWeek}`}
                >
                  {localWeekAction === "copy" ? (
                    <LoaderCircle className="button-spinner" size={17} />
                  ) : (
                    <Copy size={17} />
                  )}
                </button>
              </>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Next program week"
            onClick={() =>
              onSelectWeek(Math.min(program.weeks.length, selectedWeek + 1))
            }
            disabled={selectedWeek === program.weeks.length}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div
        className={`builder-layout${isQuickWorkout ? " quick-workout-builder" : ""}`}
      >
        {!isQuickWorkout && (
          <aside className="workout-list panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">
                  {isQuickWorkout ? "Quick workout" : `Week ${selectedWeek}`}
                </p>
                <h3>{isQuickWorkout ? "Session" : currentWeek.label}</h3>
              </div>
            </div>
            <DndContext
              sensors={dragSensors}
              collisionDetection={closestCenter}
              onDragEnd={finishWorkoutDrag}
            >
              <SortableContext
                items={currentWeek.workouts.map((workout) => workout.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="workout-list-items">
                  {currentWeek.workouts.map((workout, index) => (
                    <SortableWorkoutRow
                      key={workout.id}
                      workout={workout}
                      index={index}
                      selected={selectedWorkout?.id === workout.id}
                      editable={dragEnabled}
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
                  <SortableContext
                    items={selectedWorkout.sections.map(
                      (section) => `section:${section.id}`,
                    )}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="builder-section-list">
                      {selectedWorkout.sections.map((section) => (
                        <SortableBuilderSection
                          key={section.id}
                          section={section}
                          selected={selectedTargetSection?.id === section.id}
                          editable={editable}
                          dragEnabled={dragEnabled}
                          canDelete={section.kind !== "main"}
                          onSelect={() => onSelectSection(section.id)}
                          onEdit={() => onEditSection(section)}
                          onDelete={() => onDeleteSection(section)}
                          onAddExercise={() =>
                            openMobileExercisePicker(section.id)
                          }
                          onEditItem={onEditItem}
                          onRemoveItem={onRemoveItem}
                          renderWorkoutItem={renderWorkoutItem}
                        />
                      ))}
                    </div>
                  </SortableContext>
                ) : (
                  renderWorkoutDetails(selectedWorkout)
                )}
                {editable && (
                  <button
                    className="button secondary add-section-button"
                    onClick={onAddSection}
                  >
                    <Plus size={15} />
                    Add section
                  </button>
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
          {editable && !mobilePickerSectionId && (
            <aside
              className="exercise-picker desktop-exercise-picker panel"
              aria-busy={mutationPending || pickerLoading}
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Exercise library</p>
                  <h3>{`Add to ${pickerTargetSection?.title ?? "section"}`}</h3>
                </div>
              </div>
              {exercisePickerBody}
            </aside>
          )}
          {editable && mobilePickerSectionId && (
            <ModalShell
              title={`Add to ${pickerTargetSection?.title ?? "section"}`}
              description="Choose an exercise, then set its prescription."
              onClose={closeMobileExercisePicker}
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

function DraggableExercisePickerRow({
  exercise,
  disabled,
  onAdd,
}: {
  exercise: Exercise;
  disabled: boolean;
  onAdd: () => void;
}) {
  const style = inferredExerciseDiscipline(exercise);
  const StyleIcon =
    exerciseTrainingStyles.find((item) => item.value === style)?.icon ??
    Dumbbell;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `picker:${exercise.id}`,
      data: { type: "library-exercise", exerciseId: exercise.id },
      disabled,
    });
  return (
    <div
      ref={setNodeRef}
      className={cn("picker-result-row", isDragging && "dragging")}
      style={{ transform: CSS.Translate.toString(transform) }}
    >
      <button
        className="drag-handle picker-drag-handle"
        type="button"
        disabled={disabled}
        aria-label={`Drag ${exercise.name} into a workout section`}
        title="Drag into any section"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button
        className="picker-result-main"
        type="button"
        disabled={disabled}
        onClick={onAdd}
      >
        <span
          className={cn("exercise-style-icon", style)}
          title={exerciseTrainingStyleLabel(style)}
          aria-label={exerciseTrainingStyleLabel(style)}
        >
          <StyleIcon size={15} />
        </span>
        <div>
          <strong>{exercise.name}</strong>
          <small>
            {exercise.category} · {modeLabel(exercise.defaultMode)}
          </small>
        </div>
        <Plus size={15} />
      </button>
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

function SortableBuilderSection({
  section,
  selected,
  editable,
  dragEnabled,
  canDelete,
  onSelect,
  onEdit,
  onDelete,
  onAddExercise,
  onEditItem,
  onRemoveItem,
  renderWorkoutItem,
}: {
  section: WorkoutSection;
  selected: boolean;
  editable: boolean;
  dragEnabled: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddExercise: () => void;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
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
    id: `section:${section.id}`,
    data: { type: "section", sectionId: section.id },
    disabled: !dragEnabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "builder-section",
        selected && "selected",
        isDragging && "dragging",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="builder-section-heading">
        {dragEnabled ? (
          <button
            className="drag-handle section-drag-handle"
            type="button"
            aria-label={`Drag ${section.title} section to reorder`}
            title="Drag section to reorder"
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
        ) : (
          <span className="drag-handle-placeholder" aria-hidden />
        )}
        <div className="section-title-group">
          <button className="section-title-button" onClick={onSelect}>
            <span>{section.title}</span>
            <small>{section.kind ?? "custom"}</small>
          </button>
          {editable && (
            <div className="section-actions">
              <button
                className="section-action"
                onClick={onEdit}
                aria-label={`Edit ${section.title}`}
                title="Edit section"
              >
                <Pencil size={12} />
              </button>
              {canDelete && (
                <button
                  className="section-action danger"
                  onClick={onDelete}
                  aria-label={`Delete ${section.title}`}
                  title={`Delete ${section.title} section`}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <SortableExerciseList
        section={section}
        editable={editable}
        dragEnabled={dragEnabled}
        onAddExercise={onAddExercise}
        onEditItem={onEditItem}
        onRemoveItem={onRemoveItem}
        renderWorkoutItem={renderWorkoutItem}
      />
    </div>
  );
}

function SortableExerciseList({
  section,
  editable,
  dragEnabled,
  onAddExercise,
  onEditItem,
  onRemoveItem,
  renderWorkoutItem,
}: {
  section: WorkoutSection;
  editable: boolean;
  dragEnabled: boolean;
  onAddExercise: () => void;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
  renderWorkoutItem: (item: WorkoutItem) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `item-list:${section.id}`,
    data: { type: "item-list", sectionId: section.id },
    disabled: !dragEnabled,
  });
  return (
    <SortableContext
      items={section.items.map((item) => `item:${item.id}`)}
      strategy={verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={cn("builder-item-list", isOver && "drop-target")}
      >
        {section.items.length ? (
          section.items.map((item, index) => (
            <SortableExerciseItem
              key={item.id}
              item={item}
              index={index}
              sectionId={section.id}
              editable={editable}
              dragEnabled={dragEnabled}
              onEdit={() => onEditItem(item)}
              onRemove={() => onRemoveItem(item.id)}
              renderWorkoutItem={renderWorkoutItem}
            />
          ))
        ) : (
          <div className="empty-inline exercise-drop-empty">
            {editable
              ? "Drop an exercise here"
              : "No items in this section yet."}
          </div>
        )}
        {editable && (
          <button
            className="section-add-exercise"
            type="button"
            onClick={onAddExercise}
          >
            <Plus size={17} />
            Add exercise
          </button>
        )}
      </div>
    </SortableContext>
  );
}

function SortableExerciseItem({
  item,
  index,
  sectionId,
  editable,
  dragEnabled,
  onEdit,
  onRemove,
  renderWorkoutItem,
}: {
  item: WorkoutItem;
  index: number;
  sectionId: string;
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
    data: { type: "item", itemId: item.id, sectionId },
    disabled: !dragEnabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "builder-item",
        "builder-exercise-preview",
        isDragging && "dragging",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {dragEnabled ? (
        <button
          className="drag-handle"
          type="button"
          aria-label={`Drag ${item.title} to reorder or move section`}
          title="Drag to reorder or move section"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      ) : (
        <span className="drag-handle-placeholder" aria-hidden />
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
