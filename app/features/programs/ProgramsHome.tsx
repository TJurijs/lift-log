import { Activity, CalendarDays, Check, ChevronDown, CircleUserRound, History, LoaderCircle, Play, Plus, RefreshCw, Search, Settings2, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CompletedSession, Program, ProgramRunDetail, ProgramRunSummary, ProgramRunWorkout } from "../../../lib/domain";
import type { TrainingContentCapabilities } from "../../../lib/capabilities";
import { formatDateOnly, localDateOnly } from "../../../lib/date-only";
import { cn, formatWorkoutCount } from "../../../lib/presentation";
import { programWorkoutCount, programWorkouts } from "../../../lib/program-tree";
import { ObjectActionMenu, type ObjectAction } from "../../object-action-menu";
import { AsyncButton, InlineError, PageHeader, SegmentedTabs } from "../../ui-primitives";
import { actionUi, trainingContentUi } from "../../ui-semantics";
import { isTrainingHistory, trainingDateSection, trainingFeed, type TrainingFeedItem } from "./training-feed";

const ProgramIcon = trainingContentUi("program").icon;
const WorkoutIcon = trainingContentUi("quick_workout").icon;
export type ProgramSourceTab = "all" | "own" | "coach";
export type ProgramAction = { id: string; kind: "delete" | "save" | "duplicate" | "edit" | "open" } | null;

export interface ProgramsHomeProps {
  programs: Program[];
  programRuns: ProgramRunSummary[];
  hasMoreRuns: boolean;
  runsLoading: boolean;
  runsError: string;
  viewerId: string;
  source: ProgramSourceTab;
  hasCoach: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string;
  action: ProgramAction;
  capabilitiesForProgram: (program: Program) => TrainingContentCapabilities;
  onOpen: (program: Program) => void;
  onEdit: (program: Program, workoutId?: string) => void;
  onDuplicate: (program: Program) => void;
  onDelete: (program: Program) => void;
  onSource: (source: ProgramSourceTab) => void;
  onCreate: () => void;
  onCreateWorkout: () => void;
  onSetDates: (program: Program) => void;
  onStartProgram?: (program: Program, workoutId?: string) => void;
  onAssign?: (program: Program) => void;
  onOpenRun: (run: ProgramRunSummary) => void;
  onSetRunDates: (run: ProgramRunSummary) => void;
  onStartRunWorkout?: (run: ProgramRunSummary, slot?: ProgramRunWorkout) => void;
  onEditRunWorkout?: (run: ProgramRunSummary, slot: ProgramRunWorkout) => void;
  onRestoreRunWorkout?: (run: ProgramRunSummary, slot: ProgramRunWorkout) => void;
  onOpenRunWorkoutResults?: (run: ProgramRunSummary, slot: ProgramRunWorkout) => void;
  onLoadRunDetail?: (run: ProgramRunSummary) => Promise<ProgramRunDetail | null>;
  onLoadProgramDetail?: (program: Program) => Promise<Program | null>;
  onEndRun: (run: ProgramRunSummary) => void;
  onRepeatRun: (run: ProgramRunSummary) => void;
  onAssignRun?: (run: ProgramRunSummary) => void;
  onLoadMore: () => void;
  onLoadMoreRuns: () => void;
  historicalRuns?: ProgramRunSummary[];
  historyRunsLoading?: boolean;
  historyRunsError?: string | null;
  historyRunsHasMore?: boolean;
  onLoadHistoryRuns?: () => void;
  onLoadMoreHistoryRuns?: () => void;
  activeWorkout?: { title: string; subtitle?: string; programRunId?: string };
  onResumeWorkout?: () => void;
  startingTrainingId?: string | null;
  completedSessions?: CompletedSession[];
  completedLoading?: boolean;
  completedError?: string | null;
  completedHasMore?: boolean;
  onLoadCompleted?: () => void;
  onLoadMoreCompleted?: () => void;
  onOpenCompleted?: (session: CompletedSession) => void;
}

function dateLabel(date?: string) {
  return date ? formatDateOnly(date, { month: "short", day: "numeric" }) : "No date";
}

function Card({ title, contentType, subtitle, description, children, footer, onOpen, disabled }: {
  title: string;
  contentType: Program["contentType"];
  subtitle?: string;
  description?: string;
  children?: ReactNode;
  footer: ReactNode;
  onOpen?: () => void;
  disabled?: boolean;
}) {
  const ObjectIcon = trainingContentUi(contentType).icon;
  return <article className="panel training-card">
    <div className="training-card-heading"><span className="program-icon"><ObjectIcon size={18} /></span><div><h3>{onOpen ? <button type="button" className="training-card-open" aria-label={`Open ${title}`} onClick={onOpen} disabled={disabled}>{title}</button> : title}</h3>{subtitle && <p>{subtitle}</p>}</div></div>
    {description && <p className="training-card-description">{description}</p>}
    <div className="training-card-footer">{footer}</div>
    {children}
  </article>;
}

export function ProgramRow({ program, canEdit, canDuplicate, canDelete, action, starting = false, onOpen, onEdit, onDuplicate, onDelete, onSetDates, onStart, onAssign, onLoadDetail }: {
  program: Program;
  canEdit: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  action: Exclude<ProgramAction, null>["kind"] | null;
  starting?: boolean;
  onOpen: () => void;
  onEdit: (workoutId?: string) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSetDates?: () => void;
  onStart?: (workoutId?: string) => void;
  onAssign?: () => void;
  onLoadDetail?: () => Promise<Program | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(program.detailsLoaded === false ? null : program);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const quick = program.contentType === "quick_workout";
  const object = quick ? "workout" : "program";
  const count = programWorkoutCount(program);
  async function loadWorkouts() {
    if (detail || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await onLoadDetail?.();
      if (!result) throw new Error("Workouts could not be loaded.");
      setDetail(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workouts could not be loaded."); }
    finally { setLoading(false); }
  }
  const actions: ObjectAction[] = [
    ...(canEdit ? [{ ...actionUi.edit, accessibleLabel: `Edit ${program.title} ${object}`, onClick: () => onEdit(), loading: action === "edit" }] : []),
    ...(onSetDates ? [{ ...actionUi.schedule, label: "Set dates", accessibleLabel: `Set dates for ${program.title}`, onClick: onSetDates }] : []),
    ...(canDuplicate && onDuplicate ? [{ label: "Repeat", icon: RefreshCw, accessibleLabel: `Repeat ${program.title} ${object}`, onClick: onDuplicate, loading: action === "duplicate" }] : []),
    ...(onAssign ? [{ label: "Assign to athletes", accessibleLabel: `Assign ${program.title} to athletes`, icon: UserPlus, onClick: onAssign }] : []),
    ...(canDelete && onDelete ? [{ ...actionUi.delete, accessibleLabel: `Delete ${program.title}`, onClick: onDelete, loading: action === "delete", destructive: true }] : []),
  ].map((item) => ({ ...item, disabled: Boolean(action) }));
  return <Card title={program.title} contentType={program.contentType} description={program.description} onOpen={onOpen} disabled={Boolean(action)}
    subtitle={quick ? "Workout · No date" : `${formatWorkoutCount(count)} · No date`}
    footer={<>
      <ObjectActionMenu compact title={program.title} primary={onStart && count > 0 ? { label: "Start workout", compactLabel: "Start", accessibleLabel: `Start workout: ${program.title}`, icon: Play, onClick: () => onStart(), disabled: Boolean(action), loading: starting } : undefined} actions={actions} />
    </>}>
    {!quick && count > 0 && <>
      <button type="button" className="training-expand" aria-expanded={expanded} aria-controls={`source-workouts-${program.id}`} onClick={() => { setExpanded(!expanded); if (!expanded) void loadWorkouts(); }}>
        {expanded ? "Hide workouts" : "Show workouts"}<ChevronDown size={15} />
      </button>
      {expanded && <div id={`source-workouts-${program.id}`} className="training-workout-list">
        <LoadStatus loading={loading} error={error} onRetry={() => void loadWorkouts()} />
        {detail && programWorkouts(detail).map((workout, index) => <div className="training-workout-row" key={workout.id}>
          <div><strong>{index + 1}. {workout.title}</strong><small>No date</small></div>
          <div className="training-workout-actions">
            {canEdit && <button type="button" className="button secondary small" aria-label={`Edit ${workout.title}, workout ${index + 1}`} onClick={() => onEdit(workout.id)}>Edit</button>}
            {onStart && <button type="button" className="button secondary small" disabled={starting} aria-label={`Start ${workout.title}, workout ${index + 1}`} onClick={() => onStart(workout.id)}><Play size={14} />Start</button>}
          </div>
        </div>)}
      </div>}
    </>}
  </Card>;
}

function RunRow({ run, ...props }: ProgramsHomeProps & { run: ProgramRunSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ProgramRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const detailLoader = useRef(props.onLoadRunDetail);
  const detailRequest = useRef(0);
  useEffect(() => { detailLoader.current = props.onLoadRunDetail; }, [props.onLoadRunDetail]);
  const quick = run.contentType === "quick_workout";
  const finished = run.status === "completed" || run.status === "ended";
  const active = props.activeWorkout?.programRunId === run.id;
  const starting = props.startingTrainingId === run.id;
  const canStart = !finished && Boolean(props.onStartRunWorkout) && Boolean(run.nextWorkout);
  const loadWorkouts = useCallback(async () => {
    const request = ++detailRequest.current;
    setLoading(true);
    setError("");
    try {
      const result = await detailLoader.current?.(run);
      if (request !== detailRequest.current) return null;
      if (!result) throw new Error("Workouts could not be loaded.");
      setDetail(result);
      return result;
    } catch (cause) {
      if (request === detailRequest.current) setError(cause instanceof Error ? cause.message : "Workouts could not be loaded.");
      return null;
    } finally { if (request === detailRequest.current) setLoading(false); }
  }, [run]);
  // A changed later workout may leave every summary count and the next date unchanged.
  // Refresh an expanded card whenever its authoritative run summary is replaced.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (expanded) return loadWorkouts();
      setLoading(false);
    });
    return () => { active = false; detailRequest.current += 1; };
  }, [expanded, loadWorkouts]);
  async function editNext() {
    const loaded = await loadWorkouts();
    const slot = loaded?.workouts.find((workout) => workout.id === run.nextWorkout?.id) ?? loaded?.workouts.find((workout) => workout.canEdit);
    if (slot?.canEdit) props.onEditRunWorkout?.(run, slot);
    else if (loaded) props.onOpenRun(run);
  }
  async function restoreWorkout() {
    const loaded = await loadWorkouts();
    const skipped = loaded?.workouts.find((workout) => workout.status === "skipped");
    if (skipped) props.onRestoreRunWorkout?.(run, skipped);
    else if (loaded) props.onOpenRun(run);
  }
  const source = run.createdById === run.athleteId ? "" : "From coach · ";
  const subtitle = finished
    ? `${source}${run.status === "ended" ? "Ended" : "Completed"} · ${dateLabel((run.finishedAt ?? run.endedAt ?? run.createdAt).slice(0, 10))}`
    : `${source}${quick ? dateLabel(run.nextWorkout?.plannedDate) : `${run.completedWorkouts}/${run.totalWorkouts} completed`}`;
  const actions: ObjectAction[] = [
    ...(!finished && props.onEditRunWorkout && run.nextWorkout?.status !== "in_progress" ? [{ ...actionUi.edit, accessibleLabel: `Edit ${run.title} workout`, onClick: () => void editNext(), loading }] : []),
    ...(!finished ? [{ ...actionUi.schedule, label: run.scheduledWorkouts ? "Change dates" : "Set dates", accessibleLabel: `${run.scheduledWorkouts ? "Change" : "Set"} dates for ${run.title}`, onClick: () => props.onSetRunDates(run) }] : []),
    ...(quick && !finished && !run.nextWorkout && run.completedWorkouts < run.totalWorkouts && props.onRestoreRunWorkout ? [{ label: "Restore workout", accessibleLabel: `Restore ${run.title}`, icon: RefreshCw, onClick: () => void restoreWorkout(), loading }] : []),
    { label: "Repeat", accessibleLabel: `Repeat ${run.title}`, icon: RefreshCw, onClick: () => props.onRepeatRun(run) },
    ...(props.onAssignRun && run.createdById === props.viewerId ? [{ label: "Assign to athletes", accessibleLabel: `Assign ${run.title} to athletes`, icon: UserPlus, onClick: () => props.onAssignRun?.(run) }] : []),
    ...(!finished ? [{ ...actionUi.delete, label: "Remove from training", accessibleLabel: `Remove ${run.title} from training`, onClick: () => props.onEndRun(run), destructive: true }] : []),
  ];
  return <Card title={run.title} contentType={run.contentType} subtitle={subtitle} onOpen={() => props.onOpenRun(run)}
    description={!quick && !finished && run.nextWorkout ? `${dateLabel(run.nextWorkout.plannedDate)} · ${run.nextWorkout.title}` : undefined}
    footer={<>
      <ObjectActionMenu compact title={run.title} primary={active && props.onResumeWorkout
        ? { label: "Resume workout", compactLabel: "Resume", accessibleLabel: `Resume ${run.title}`, icon: Play, onClick: props.onResumeWorkout }
        : canStart ? { label: "Start workout", compactLabel: "Start", accessibleLabel: `Start workout: ${run.title}`, icon: Play, onClick: () => props.onStartRunWorkout?.(run), loading: starting }
          : undefined} actions={actions} />
    </>}>
    {(quick || !expanded) && <LoadStatus loading={loading} error={error} onRetry={() => void loadWorkouts()} />}
    {!quick && <>
      <button type="button" className="training-expand" aria-expanded={expanded} aria-controls={`run-workouts-${run.id}`} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Hide workouts" : "Show workouts"}<ChevronDown size={15} />
      </button>
      {expanded && <div id={`run-workouts-${run.id}`} className="training-workout-list">
        <LoadStatus loading={loading} error={error} onRetry={() => void loadWorkouts()} />
        {!loading && !error && detail?.workouts.map((slot) => {
          const completed = slot.status === "completed";
          const resumable = slot.status === "in_progress";
          const ready = slot.status === "scheduled" || slot.status === "unscheduled";
          return <div className="training-workout-row" key={slot.id}>
            <div><strong>{slot.position + 1}. {slot.title}</strong><small>{dateLabel(slot.plannedDate)}{completed ? " · Completed" : slot.status === "skipped" ? " · Skipped" : slot.status === "cancelled" ? " · Removed" : resumable ? " · In progress" : ""}</small></div>
            <div className="training-workout-actions">
              {!finished && slot.canEdit && props.onEditRunWorkout && <button type="button" className="button secondary small" aria-label={`Edit ${slot.title}`} onClick={() => props.onEditRunWorkout?.(run, slot)}>Edit</button>}
              {!finished && ready && props.onStartRunWorkout && <button type="button" className="button secondary small" disabled={starting} aria-label={`Start ${slot.title}`} onClick={() => props.onStartRunWorkout?.(run, slot)}><Play size={14} />Start</button>}
              {!finished && resumable && props.onResumeWorkout && <button type="button" className="button secondary small" onClick={props.onResumeWorkout}>Resume</button>}
              {!finished && slot.status === "skipped" && props.onRestoreRunWorkout && <button type="button" className="button secondary small" aria-label={`Restore ${slot.title}`} onClick={() => props.onRestoreRunWorkout?.(run, slot)}>Restore</button>}
              {completed && <button type="button" className="button secondary small" aria-label={`View results for ${slot.title}`} onClick={() => {
                if (props.onOpenRunWorkoutResults) { props.onOpenRunWorkoutResults(run, slot); return; }
                const session = props.completedSessions?.find((item) => item.id === slot.sessionId);
                if (session && props.onOpenCompleted) props.onOpenCompleted(session);
                else props.onOpenRun(run);
              }}>Results</button>}
            </div>
          </div>;
        })}
      </div>}
    </>}
  </Card>;
}

function LoadStatus({ loading, error, onRetry }: { loading?: boolean; error?: string | null; onRetry?: () => void }) {
  if (error) return <InlineError>{error}{onRetry && <button type="button" className="text-button" onClick={onRetry}>Try again</button>}</InlineError>;
  return loading ? <div className="feature-load-status" role="status"><LoaderCircle size={16} className="spin" />Loading workouts…</div> : null;
}

export function ProgramsHome(props: ProgramsHomeProps) {
  const [view, setView] = useState<"active" | "history">("active");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [types, setTypes] = useState<Array<"program" | "quick_workout">>([]);
  const { programs, programRuns, viewerId, source, hasCoach, action } = props;
  const today = localDateOnly();
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (title: string, type: "program" | "quick_workout" = "program") => title.toLowerCase().includes(normalizedQuery) && (!types.length || types.includes(type));
  const browseRuns = view === "history" ? props.historicalRuns ?? programRuns : programRuns;
  const feed = trainingFeed(programs, browseRuns, viewerId, source);
  const visible = feed.filter((item) => isTrainingHistory(item) === (view === "history") && matches(item.title, item.kind === "program" ? item.program.contentType : item.run.contentType));
  const completed = [...(props.completedSessions ?? [])].filter((session) => {
    const run = browseRuns.find((item) => item.id === session.programRunId);
    const coach = session.sourceType ? session.sourceType === "coach" : run && run.createdById !== viewerId;
    return (source === "all" || (source === "coach" ? coach : !coach)) && matches(session.workoutTitle, "quick_workout");
  }).sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));
  const finished = [...visible].filter((item) => item.kind === "run" && (item.run.contentType !== "quick_workout" || !completed.some((session) => session.programRunId === item.run.id)))
    .sort((left, right) => {
      const stamp = (item: TrainingFeedItem) => item.kind === "run" ? item.run.finishedAt ?? item.run.endedAt ?? item.run.createdAt : "";
      return stamp(right).localeCompare(stamp(left));
    });
  const hasResults = view === "active" ? visible.length > 0 : finished.length > 0 || completed.length > 0;
  const separateHistory = view === "history" && props.historicalRuns !== undefined;
  const runsLoading = separateHistory ? props.historyRunsLoading : props.runsLoading;
  const runsError = separateHistory ? props.historyRunsError : props.runsError;
  const runsHasMore = separateHistory ? props.historyRunsHasMore : props.hasMoreRuns;
  const loadRuns = separateHistory ? props.onLoadMoreHistoryRuns : props.onLoadMoreRuns;
  const toggleType = (type: "program" | "quick_workout") => setTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  const renderItem = (item: TrainingFeedItem) => {
    if (item.kind === "run") return <RunRow key={`${item.id}:${item.run.completedWorkouts}:${item.run.scheduledWorkouts}:${item.date ?? ""}:${item.run.status}`} {...props} run={item.run} />;
    const program = item.program;
    const capabilities = props.capabilitiesForProgram(program);
    return <ProgramRow key={item.id} program={program} canEdit={capabilities.edit} canDuplicate={capabilities.copyToOwn} canDelete={capabilities.deleteOwn}
      action={action?.id === program.id ? action.kind : null} starting={props.startingTrainingId === program.id} onOpen={() => props.onOpen(program)} onEdit={(workoutId) => props.onEdit(program, workoutId)}
      onDuplicate={() => props.onDuplicate(program)} onDelete={() => props.onDelete(program)}
      onSetDates={capabilities.schedule ? () => props.onSetDates(program) : undefined}
      onStart={props.onStartProgram ? (workoutId) => props.onStartProgram?.(program, workoutId) : undefined}
      onAssign={capabilities.assign && props.onAssign ? () => props.onAssign?.(program) : undefined}
      onLoadDetail={props.onLoadProgramDetail ? () => props.onLoadProgramDetail!(program) : undefined} />;
  };
  return <>
    <PageHeader eyebrow="Your training" title="Training">
      <details className="program-create-menu"><summary className="button primary small"><Plus size={15} />New</summary><div>
        <button type="button" onClick={props.onCreateWorkout}><WorkoutIcon size={15} /><span><strong>Workout</strong><small>One training session</small></span></button>
        <button type="button" onClick={props.onCreate}><ProgramIcon size={15} /><span><strong>Program</strong><small>A sequence of workouts</small></span></button>
      </div></details>
    </PageHeader>
    {props.activeWorkout && props.onResumeWorkout && <section className="panel training-resume" aria-label="Workout in progress">
      <Activity size={21} /><div><small>Workout in progress</small><strong>{props.activeWorkout.title}</strong>{props.activeWorkout.subtitle && <p>{props.activeWorkout.subtitle}</p>}</div>
      <button type="button" className="button primary" onClick={props.onResumeWorkout}><Play size={15} />Resume workout</button>
    </section>}
    <section className="panel program-source-browser training-browser">
      <SegmentedTabs label="Training view" panelId="training-feed" value={view} onChange={(next) => { setView(next); if (next === "history") { props.onLoadCompleted?.(); props.onLoadHistoryRuns?.(); } }} tabs={[
        { value: "active", label: "Active", icon: Activity }, { value: "history", label: "History", icon: History },
      ]} />
      <div className="library-toolbar program-filter-toolbar">
        <div className="library-filter-actions"><label className="search-field library-search"><Search size={17} /><input aria-label="Search programs and workouts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search training" /></label>
          <button type="button" className={cn("button secondary small library-filter-trigger", filtersOpen && "active")} aria-expanded={filtersOpen} aria-controls="program-filter-panel" onClick={() => setFiltersOpen(!filtersOpen)}><Settings2 size={15} />Filters{types.length ? ` · ${types.length}` : ""}</button>
        </div>
        {hasCoach && <SegmentedTabs label="Training sources" selectionMode="buttons" value={source} onChange={props.onSource} tabs={[{ value: "all", label: "All training" }, { value: "own", label: "My training", icon: CircleUserRound }, { value: "coach", label: "From coach", icon: Users }]} />}
        {types.length > 0 && <div className="library-active-filters" aria-label="Active training filters">{types.map((type) => <button type="button" className="program-filter-type" key={type} onClick={() => toggleType(type)}>{type === "program" ? "Programs" : "Workouts"} <X size={12} /></button>)}<button type="button" className="clear" onClick={() => setTypes([])}>Clear filters</button></div>}
        {filtersOpen && <div className="library-filter-panel program-filter-panel" id="program-filter-panel"><div><span>Type</span><div className="library-filter-chip-row">{(["program", "quick_workout"] as const).map((type) => <button type="button" key={type} className={cn("program-filter-type", types.includes(type) && "active")} aria-pressed={types.includes(type)} onClick={() => toggleType(type)}>{type === "program" ? "Programs" : "Workouts"}</button>)}</div></div></div>}
      </div>
      <div id="training-feed" role="tabpanel" aria-labelledby={`training-feed-${view}-tab`} className="training-feed">
        {view === "active" ? (["Today and overdue", "Upcoming", "No date"] as const).map((title) => {
          const items = visible.filter((item) => trainingDateSection(item, today) === title);
          return items.length > 0 && <section className="training-feed-section" aria-label={title} key={title}><div className="program-content-heading"><span><CalendarDays size={15} /><strong>{title}</strong></span><small>{items.length}</small></div><div className="training-card-list">{items.map(renderItem)}</div></section>;
        }) : <>
          {finished.length > 0 && <section className="training-feed-section" aria-label="Finished training"><h2>Finished training</h2><div className="training-card-list">{finished.map(renderItem)}</div></section>}
          {completed.length > 0 && <section className="training-feed-section" aria-label="Completed workouts"><h2>Completed workouts</h2><div className="training-card-list">{completed.map((session) => <Card key={session.id} title={session.workoutTitle} contentType="quick_workout" subtitle={`Completed · ${dateLabel(session.date)}`} footer={<button type="button" className="button secondary small" aria-label={`View results for ${session.workoutTitle}`} onClick={() => props.onOpenCompleted?.(session)}><Check size={15} />View results</button>} />)}</div></section>}
          <LoadStatus loading={props.completedLoading} error={props.completedError} onRetry={props.completedHasMore ? props.onLoadMoreCompleted : props.onLoadCompleted} />
          {props.completedHasMore && !props.completedError && <AsyncButton className="button secondary library-load-more" loading={props.completedLoading} loadingLabel="Loading history…" onClick={props.onLoadMoreCompleted}>Load older workouts</AsyncButton>}
        </>}
        {!hasResults && !runsLoading && !runsError && !(view === "history" && (props.completedLoading || props.completedError)) && <div className="empty-state compact"><Search size={24} /><h3>{query || types.length ? "No matching training" : view === "history" ? "No training history yet" : source === "coach" ? "No coach training" : "No workouts or programs yet"}</h3><p>{query || types.length ? "Adjust the search or filters to see more training." : view === "history" ? "Completed workouts and finished programs appear here." : source === "coach" ? "Training assigned by your coach will appear here." : "Create a workout, or a program with several workouts. Dates are optional."}</p>{(query || types.length > 0) && <button type="button" className="button secondary small" onClick={() => { setQuery(""); setTypes([]); }}>Clear search and filters</button>}</div>}
        <LoadStatus loading={runsLoading} error={runsError} onRetry={separateHistory && !props.historyRunsHasMore ? props.onLoadHistoryRuns : loadRuns} />
        {runsHasMore && !runsError && <AsyncButton className="button secondary library-load-more" loading={runsLoading} loadingLabel="Loading training…" onClick={loadRuns}>Load more training</AsyncButton>}
        {source !== "coach" && view === "active" && <><LoadStatus error={props.loadError} onRetry={props.onLoadMore} />{props.hasMore && <AsyncButton className="button secondary library-load-more" loading={props.loadingMore} loadingLabel="Loading…" onClick={props.onLoadMore}>Load more workouts and programs</AsyncButton>}</>}
      </div>
    </section>
  </>;
}
