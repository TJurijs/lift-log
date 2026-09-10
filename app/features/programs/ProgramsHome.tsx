import { ObjectActionMenu, type ObjectAction } from "../../object-action-menu";
import { ArrowLeft, ArrowRight, ChevronRight, CircleUserRound, LoaderCircle, Plus, Search, Settings2, Users, X } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import type { AthleteSummary, Program, ProgramRunSummary } from "../../../lib/domain";
import type { TrainingContentCapabilities } from "../../../lib/capabilities";
import { cn, formatWorkoutCount } from "../../../lib/presentation";
import { presentProgramProvenance } from "../../../lib/provenance";
import { programWorkoutCount } from "../../../lib/program-tree";
import { AsyncButton, InlineError, PageHeader, SegmentedTabs, SourceTag, StatusBadge } from "../../ui-primitives";
import { actionUi, trainingContentUi } from "../../ui-semantics";
const ProgramIcon = trainingContentUi("program").icon;
const WorkoutIcon = trainingContentUi("quick_workout").icon;
export type ProgramSourceTab = "own" | "coach";
export type ProgramAction = { id: string; kind: "delete" | "save" | "duplicate" | "edit" | "open" } | null;
const CoachProgramRuns = lazy(() => import("../program-runs/SelfProgramRuns").then(({ CoachProgramRuns: component }) => ({ default: component })));

export function ProgramRow({
  program,
  activeRun,
  viewerId,
  canEdit,
  canDuplicate,
  canDelete,
  action,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  deleteLabel = "Delete",
  onSchedule,
  onOpenActiveRun,
}: {
  program: Program;
  activeRun?: ProgramRunSummary;
  viewerId: string;
  canEdit: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  action: Exclude<ProgramAction, null>["kind"] | null;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  deleteLabel?: "Delete" | "Unassign";
  onSchedule?: () => void;
  onOpenActiveRun?: () => void;
}) {
  const isQuickWorkout = program.contentType === "quick_workout";
  const { label: objectLabel, icon: ObjectIcon } = trainingContentUi(program.contentType);
  const useLabel = program.sourceType === "coach" ? "Schedule" : `Use ${objectLabel.toLowerCase()}`;
  const workoutCount = programWorkoutCount(program);
  const estimatedMinutes = program.weeks[0]?.workouts[0]?.durationMinutes;
  return (
    <article className="program-catalog-card panel">
      <button
        type="button"
        className="program-card-main"
        disabled={Boolean(action)}
        onClick={onOpen}
      >
        <span className="program-card-heading">
          <span className="program-icon">
            <ObjectIcon size={18} />
          </span>
          <span>
            <strong>{program.title}</strong>
            {program.sourceType !== "self" && (
              <SourceTag
                presentation={presentProgramProvenance(program, viewerId)}
                compact
              />
            )}
          </span>
          {action === "open" ? (
            <span className="program-card-loading" aria-label={`Opening ${objectLabel.toLowerCase()}`}>
              <LoaderCircle className="button-spinner" size={16} />
            </span>
          ) : <ChevronRight size={16} aria-hidden="true" />}
        </span>
        {program.description && (
          <span className="program-card-description">{program.description}</span>
        )}
      </button>
      <div className="program-card-footer">
        <div className="program-card-status-row">
          <span className="program-card-meta">
            {isQuickWorkout ? (
              estimatedMinutes ? <span>~{estimatedMinutes} min</span> : null
            ) : (
              <span>{formatWorkoutCount(workoutCount)}</span>
            )}
          </span>
          {activeRun ? (
            <>
              <span className="program-card-ready">{isQuickWorkout ? "In use" : `In use · ${activeRun.completedWorkouts}/${activeRun.totalWorkouts} completed`}</span>
              {onOpenActiveRun && <button type="button" className="program-card-active-run" disabled={Boolean(action)} onClick={onOpenActiveRun} aria-label={`View active plan for ${program.title}`}>
                View active plan <ChevronRight size={13} />
              </button>}
            </>
          ) : program.versionStatus === "draft" ? (
            <StatusBadge status="editable" label="Template" />
          ) : program.sourceType === "coach" ? (
            <StatusBadge status="planned" label="Assigned to you" />
          ) : (
            <span className="program-card-ready">Ready to use</span>
          )}
        </div>
        <ObjectActionMenu title={program.title}
          primary={onSchedule ? { label: useLabel, accessibleLabel: `${useLabel}: ${program.title}`, icon: program.sourceType === "coach" ? actionUi.schedule.icon : actionUi.use.icon, onClick: onSchedule, disabled: Boolean(action) } : undefined}
          actions={[
            ...(canEdit ? [{ ...actionUi.edit, accessibleLabel: `Edit ${program.title} ${objectLabel.toLowerCase()}`, onClick: onEdit, loading: action === "edit" }] : []),
            ...(canDuplicate && onDuplicate ? [{ ...actionUi.duplicate, accessibleLabel: `Duplicate ${program.title} ${objectLabel.toLowerCase()}`, onClick: onDuplicate, loading: action === "duplicate" }] : []),
            ...(canDelete && onDelete ? [{ ...actionUi.delete, label: deleteLabel, accessibleLabel: `${deleteLabel} ${program.title}`, onClick: onDelete, loading: action === "delete", destructive: true }] : []),
          ].map((item): ObjectAction => ({ ...item, disabled: Boolean(action) }))}
        />
      </div>
    </article>
  );
}

export function ProgramsHome({
  programs,
  programRuns,
  hasMoreProgramRuns,
  programRunsLoadingMore,
  programRunsLoadError,
  viewerId,
  source,
  hasCoach,
  hasMore,
  loadingMore,
  loadError,
  action,
  capabilitiesForProgram,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onUnassign,
  onSource,
  onCreate,
  onCreateWorkout,
  onSchedule,
  onOpenRun,
  onScheduleRun,
  onEndRun,
  onRepeatRun,
  onLoadMore,
  onLoadMoreProgramRuns,
}: {
  programs: Program[];
  programRuns: ProgramRunSummary[];
  hasMoreProgramRuns: boolean;
  programRunsLoadingMore: boolean;
  programRunsLoadError: string;
  viewerId: string;
  source: ProgramSourceTab;
  hasCoach: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string;
  action: ProgramAction;
  capabilitiesForProgram: (program: Program) => TrainingContentCapabilities;
  onOpen: (program: Program) => void;
  onEdit: (program: Program) => void;
  onDuplicate: (program: Program) => void;
  onDelete: (program: Program) => void;
  onUnassign: (program: Program) => void;
  onSource: (source: ProgramSourceTab) => void;
  onCreate: () => void;
  onCreateWorkout: () => void;
  onSchedule: (program: Program) => void;
  onOpenRun: (run: ProgramRunSummary) => void;
  onScheduleRun: (run: ProgramRunSummary) => void;
  onEndRun: (run: ProgramRunSummary) => void;
  onRepeatRun: (run: ProgramRunSummary) => void;
  onLoadMore: () => void;
  onLoadMoreProgramRuns: () => void;
}) {
  const [contentQuery, setContentQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<
    Array<"program" | "quick_workout">
  >([]);
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const own = programs.filter((program) => program.sourceType === "self");
  const content = source === "own" ? own : [];
  const normalizedQuery = contentQuery.trim().toLowerCase();
  const coachRuns = programRuns.filter(
    (run) => run.athleteId === viewerId && run.createdById !== viewerId,
  );
  const activeSelfRuns = programRuns.filter(
    (run) =>
      run.athleteId === viewerId &&
      run.createdById === viewerId &&
      (run.status === "not_started" || run.status === "in_progress"),
  );
  const activeRunByProgramId = new Map<string, ProgramRunSummary>();
  for (const run of activeSelfRuns) {
    if (!activeRunByProgramId.has(run.programId)) {
      activeRunByProgramId.set(run.programId, run);
    }
  }
  const filteredCoachRuns = coachRuns.filter((run) => {
    const contentType = run.contentType ?? "program";
    return (
      run.title.toLowerCase().includes(normalizedQuery) &&
      (!selectedTypes.length || selectedTypes.includes(contentType))
    );
  });
  const filteredContent = content.filter((item) => {
    const contentType = item.contentType ?? "program";
    return (
      `${item.title} ${item.description}`
        .toLowerCase()
        .includes(normalizedQuery) &&
      (!selectedTypes.length || selectedTypes.includes(contentType))
    );
  });
  const activeFilterCount = selectedTypes.length;
  function toggleProgramType(value: "program" | "quick_workout") {
    setPage(0);
    setSelectedTypes((current) =>
      current.includes(value)
        ? current.filter((candidate) => candidate !== value)
        : [...current, value],
    );
  }
  function resetProgramFilters() {
    setPage(0);
    setSelectedTypes([]);
  }
  function resetProgramSearchAndFilters() {
    resetProgramFilters();
    setContentQuery("");
  }
  const sortDraftsFirst = (items: Program[]) =>
    [...items].sort(
      (left, right) =>
        Number(left.versionStatus !== "draft") -
        Number(right.versionStatus !== "draft"),
    );
  const programItems = sortDraftsFirst(
    filteredContent.filter((item) => item.contentType !== "quick_workout"),
  );
  const workoutItems = sortDraftsFirst(
    filteredContent.filter((item) => item.contentType === "quick_workout"),
  );
  const orderedContent = [...programItems, ...workoutItems];
  const pageCount = Math.max(1, Math.ceil(orderedContent.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleIds = new Set(
    orderedContent
      .slice(currentPage * pageSize, currentPage * pageSize + pageSize)
      .map((item) => item.id),
  );
  const visibleProgramItems = programItems.filter((item) => visibleIds.has(item.id));
  const visibleWorkoutItems = workoutItems.filter((item) => visibleIds.has(item.id));
  const renderRow = (item: Program) => {
    const activeRun = activeRunByProgramId.get(item.id);
    return (
      <ProgramRow
      key={item.id}
      program={item}
      activeRun={activeRun}
      viewerId={viewerId}
      canEdit={!activeRun && capabilitiesForProgram(item).edit}
      canDuplicate={capabilitiesForProgram(item).copyToOwn}
      canDelete={!activeRun && (
        capabilitiesForProgram(item).deleteOwn ||
        (item.sourceType === "coach" && Boolean(item.assignmentId))
      )}
      action={action?.id === item.id ? action.kind : null}
      onOpen={() => onOpen(item)}
      onEdit={() => onEdit(item)}
      onDuplicate={capabilitiesForProgram(item).copyToOwn ? () => onDuplicate(item) : undefined}
      onDelete={
        capabilitiesForProgram(item).deleteOwn
          ? () => onDelete(item)
          : item.sourceType === "coach" && item.assignmentId
            ? () => onUnassign(item)
            : undefined
      }
      deleteLabel={item.sourceType === "coach" ? "Unassign" : "Delete"}
      onSchedule={capabilitiesForProgram(item).schedule ? () => onSchedule(item) : undefined}
      onOpenActiveRun={activeRun ? () => onOpenRun(activeRun) : undefined}
    />
    );
  };
  return (
    <>
      <PageHeader
        eyebrow="Your training"
        title="Programs"
        description="Build reusable programs and workouts. Changes are saved for future uses without altering active or completed plans."
      >
        <details className="program-create-menu">
          <summary className="button primary small"><Plus size={15} />New</summary>
          <div>
            <button type="button" onClick={onCreate}><ProgramIcon size={15} /><span><strong>Program</strong><small>Multiple ordered workouts</small></span></button>
            <button type="button" onClick={onCreateWorkout}><WorkoutIcon size={15} /><span><strong>Workout</strong><small>One reusable session</small></span></button>
          </div>
        </details>
      </PageHeader>
      <section className="program-source-browser panel">
        <SegmentedTabs
          className="program-source-tabs"
          label="Program sources"
          panelId="program-source-panel"
          value={source}
          onChange={(nextSource) => {
            setPage(0);
            onSource(nextSource);
          }}
          tabs={[
            { value: "own", label: "My training", icon: CircleUserRound },
            ...(hasCoach ? [{ value: "coach" as const, label: "From coach", icon: Users }] : []),
          ]}
        />
        <div className="library-toolbar program-filter-toolbar">
          <div className="library-filter-actions">
            <label className="search-field library-search">
              <Search size={17} />
              <input
                aria-label="Search programs and workouts"
                value={contentQuery}
                onChange={(event) => {
                  setPage(0);
                  setContentQuery(event.target.value);
                }}
                placeholder="Search programs and workouts"
              />
            </label>
            <button
              className={cn(
                "button secondary small library-filter-trigger",
                filtersOpen && "active",
              )}
              aria-expanded={filtersOpen}
              aria-controls="program-filter-panel"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Settings2 size={15} />
              Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
            </button>
          </div>
          {activeFilterCount > 0 && (
            <div className="library-active-filters" aria-label="Active program filters">
              {selectedTypes.map((type) => (
                <button
                  className="program-filter-type"
                  key={type}
                  onClick={() => toggleProgramType(type)}
                >
                  {type === "program" ? "Programs" : "Workouts"} <X size={12} />
                </button>
              ))}
              <button className="clear" onClick={resetProgramFilters}>Clear filters</button>
            </div>
          )}
          {filtersOpen && (
            <div className="library-filter-panel program-filter-panel" id="program-filter-panel">
              <div>
                <span>Type</span>
                <div className="library-filter-chip-row">
                  {([
                    ["program", "Programs"],
                    ["quick_workout", "Workouts"],
                  ] as const).map(([type, label]) => (
                    <button
                      className={cn(
                        "program-filter-type",
                        selectedTypes.includes(type) && "active",
                      )}
                      key={type}
                      aria-pressed={selectedTypes.includes(type)}
                      onClick={() => toggleProgramType(type)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="program-compact-list" id="program-source-panel" role="tabpanel">
          {source === "coach" ? (
            coachRuns.length > 0 && !filteredCoachRuns.length ? (
              <div className="empty-state compact">
                <Search size={24} />
                <h3>No matching training</h3>
                <p>Adjust the search or filters to see assigned programs and workouts.</p>
                <button className="button secondary small" onClick={resetProgramSearchAndFilters}>
                  Clear search and filters
                </button>
                {programRunsLoadError ? (
                  <div className="feature-load-status error" role="alert">
                    <span>{programRunsLoadError}</span>
                    <button className="text-button" onClick={onLoadMoreProgramRuns}>
                      Try again
                    </button>
                  </div>
                ) : hasMoreProgramRuns ? (
                  <button
                    className="button secondary small library-load-more"
                    disabled={programRunsLoadingMore}
                    onClick={onLoadMoreProgramRuns}
                  >
                    {programRunsLoadingMore && (
                      <LoaderCircle className="button-spinner" size={14} />
                    )}
                    {programRunsLoadingMore ? "Loading…" : "Search older training"}
                  </button>
                ) : null}
              </div>
            ) : (
              <Suspense fallback={null}>
                <CoachProgramRuns
                  viewerId={viewerId}
                  runs={filteredCoachRuns}
                  hasMore={hasMoreProgramRuns}
                  loadingMore={programRunsLoadingMore}
                  loadError={programRunsLoadError}
                  onLoadMore={onLoadMoreProgramRuns}
                  onOpen={onOpenRun}
                  onSchedule={onScheduleRun}
                  onEnd={onEndRun}
                  onRepeat={onRepeatRun}
                />
              </Suspense>
            )
          ) : filteredContent.length ? (
            <>
              {visibleProgramItems.length > 0 && (
                <section className="program-content-section" aria-labelledby="program-list-heading">
                  <div className="program-content-heading">
                    <span><ProgramIcon size={15} /><strong id="program-list-heading">Programs</strong></span>
                    <small>{programItems.length}</small>
                  </div>
                  <div className="program-content-cards">{visibleProgramItems.map(renderRow)}</div>
                </section>
              )}
              {visibleWorkoutItems.length > 0 && (
                <section className="program-content-section" aria-labelledby="workout-list-heading">
                  <div className="program-content-heading">
                    <span><WorkoutIcon size={15} /><strong id="workout-list-heading">Workouts</strong></span>
                    <small>{workoutItems.length}</small>
                  </div>
                  <div className="program-content-cards">{visibleWorkoutItems.map(renderRow)}</div>
                </section>
              )}
              {pageCount > 1 && (
                <nav className="library-pagination" aria-label="Program pages">
                  <button
                    className="button secondary small"
                    disabled={currentPage === 0}
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                  >
                    <ArrowLeft size={14} /> Previous
                  </button>
                  <span>Page {currentPage + 1} of {pageCount}</span>
                  <button
                    className="button secondary small"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() =>
                      setPage((current) => Math.min(pageCount - 1, current + 1))
                    }
                  >
                    Next <ArrowRight size={14} />
                  </button>
                </nav>
              )}
              {loadError && <InlineError>{loadError}</InlineError>}
              {hasMore && (
                <button
                  className="button secondary small library-load-more"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                >
                  {loadingMore && (
                    <LoaderCircle className="button-spinner" size={14} />
                  )}
                  {loadingMore ? "Loading…" : "Load more programs"}
                </button>
              )}
            </>
          ) : content.length ? (
            <div className="empty-state compact">
              <Search size={24} />
              <h3>No matching training content</h3>
              <p>{hasMore ? "No matches in the programs loaded so far. Search older programs or adjust your filters." : "Adjust the search or filters to see more programs and workouts."}</p>
              <button className="button secondary small" onClick={resetProgramSearchAndFilters}>
                Clear search and filters
              </button>
              {loadError && <InlineError>{loadError}</InlineError>}
              {hasMore && (
                <AsyncButton className="button secondary small library-load-more" loading={loadingMore} loadingLabel="Loading…" onClick={onLoadMore}>
                  Search older programs
                </AsyncButton>
              )}
            </div>
          ) : (
            <div className="empty-state compact">
              <ProgramIcon size={24} />
              <h3>No training content yet</h3>
              <p>Create a program or a workout when you are ready to plan training.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export function CoachProgramEmpty({
  athlete,
  onCreate,
}: {
  athlete: AthleteSummary;
  onCreate: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="My athletes"
        title={`${athlete.name} has no program`}
        description="Create the training content and order. The athlete will decide when each workout appears on their calendar."
      />
      <section className="panel empty-state coach-program-empty">
        <Users size={28} />
        <h3>Create a future plan</h3>
        <p>
          No program is created merely by opening this athlete. Start only when
          you are ready to assign one.
        </p>
        <button className="button primary" onClick={onCreate}>
          <ProgramIcon size={15} />
          Create program for {athlete.name.split(" ")[0]}
        </button>
      </section>
    </>
  );
}
