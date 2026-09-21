import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Program, ProgramRunSummary } from "../../../lib/domain";
import { formatDateOnly } from "../../../lib/date-only";
import { InlineError, ModalShell } from "../../ui-primitives";
import { trainingContentUi } from "../../ui-semantics";
import "./training-date-picker.css";

export interface TrainingDatePickerProps {
  programs: Program[];
  runs: ProgramRunSummary[];
  viewerId: string;
  initialDate: string;
  onChooseProgram: (program: Program) => void;
  onChooseRun: (run: ProgramRunSummary) => void;
  onClose: () => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  hasMorePrograms?: boolean;
  hasMoreRuns?: boolean;
  loadingMorePrograms?: boolean;
  loadingMoreRuns?: boolean;
  onLoadMorePrograms?: () => void;
  onLoadMoreRuns?: () => void;
}

/** Selects existing training. Choosing dates never repeats or assigns it. */
export function TrainingDatePicker({
  programs, runs, viewerId, initialDate, onChooseProgram, onChooseRun, onClose,
  loading = false, error, onRetry, hasMorePrograms, hasMoreRuns,
  loadingMorePrograms, loadingMoreRuns, onLoadMorePrograms, onLoadMoreRuns,
}: TrainingDatePickerProps) {
  const [search, setSearch] = useState("");
  const choices = useMemo(() => {
    const ownRuns = runs.filter((run) => run.athleteId === viewerId);
    const representedPrograms = new Set(ownRuns.map((run) => run.programId));
    const query = search.trim().toLocaleLowerCase();
    return [
      ...ownRuns
        .filter((run) => run.status === "not_started" || run.status === "in_progress")
        .map((run) => ({
          key: `run:${run.id}`, title: run.title, contentType: run.contentType,
          nextTitle: run.nextWorkout?.title, date: run.nextWorkout?.plannedDate,
          workoutCount: run.totalWorkouts, choose: () => onChooseRun(run),
        })),
      ...programs
        .filter((program) => program.athleteId === viewerId && program.createdById === viewerId
          && program.sourceType === "self" && !program.hasOwnRuns
          && !program.editableRunId && !program.programRunId && !representedPrograms.has(program.id))
        .map((program) => ({
          key: `program:${program.id}`, title: program.title, contentType: program.contentType,
          nextTitle: undefined, date: undefined,
          workoutCount: program.workoutCount ?? program.weeks.reduce((count, week) => count + week.workouts.length, 0),
          choose: () => onChooseProgram(program),
        })),
    ].filter((choice) => !query || `${choice.title} ${choice.nextTitle ?? ""}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => (left.date ?? "9999").localeCompare(right.date ?? "9999")
        || left.title.localeCompare(right.title) || left.key.localeCompare(right.key));
  }, [onChooseProgram, onChooseRun, programs, runs, search, viewerId]);
  const canLoadMore = (hasMorePrograms && onLoadMorePrograms) || (hasMoreRuns && onLoadMoreRuns);
  const loadingMore = loadingMorePrograms || loadingMoreRuns;

  return (
    <ModalShell title="Set training dates" className="training-date-picker" onClose={onClose}
      description={formatDateOnly(initialDate, { day: "numeric", month: "long" })}>
      <label className="search-field training-date-search">
        <Search size={16} aria-hidden="true" />
        <input aria-label="Search training" placeholder="Search workouts and programs" value={search}
          onChange={(event) => setSearch(event.target.value)} />
      </label>
      {error && <InlineError>{error}{onRetry && <button type="button" className="button secondary small" onClick={onRetry}>Try again</button>}</InlineError>}
      <div className="training-date-choices" aria-label="Your training" aria-busy={loading || undefined}>
        {choices.map((choice) => {
          const { label, icon: Icon } = trainingContentUi(choice.contentType);
          return <button type="button" key={choice.key} className="training-date-choice"
            aria-label={`Set dates for ${choice.title}`} onClick={choice.choose}>
            <Icon size={19} aria-hidden="true" />
            <span><strong>{choice.title}</strong>
              <small>{label}{choice.contentType !== "quick_workout" ? ` · ${choice.workoutCount} workouts` : ""}
                {choice.date ? ` · ${formatDateOnly(choice.date, { day: "numeric", month: "short" })}` : " · No date"}</small>
              {choice.nextTitle && choice.nextTitle !== choice.title && <small>Next: {choice.nextTitle}</small>}
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>;
        })}
        {!choices.length && !error && <p className="training-date-empty" role="status">
          {loading ? "Loading training…" : search.trim()
            ? "No matching training in the loaded results."
            : canLoadMore ? "More training is available. Load more to find unfinished workouts and programs."
              : "No unfinished training here. Create or repeat a workout or program from Training."}
        </p>}
      </div>
      {canLoadMore && <button type="button" className="button secondary" disabled={loadingMore} onClick={() => {
        if (hasMorePrograms && onLoadMorePrograms) onLoadMorePrograms();
        if (hasMoreRuns && onLoadMoreRuns) onLoadMoreRuns();
      }}>{loadingMore ? "Loading…" : "Load more training"}</button>}
    </ModalShell>
  );
}
