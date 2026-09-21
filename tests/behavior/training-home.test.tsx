import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProgramsHome, type ProgramsHomeProps } from "../../app/features/programs/ProgramsHome";
import { ProgramRunCompactCard } from "../../app/features/program-runs/ProgramRunCompactCard";
import { trainingDateSection, trainingFeed } from "../../app/features/programs/training-feed";
import { initialProgram } from "../../lib/demo-data";
import { localDateOnly, addCalendarDays } from "../../lib/date-only";
import type { Program, ProgramRunSummary, ProgramRunWorkout } from "../../lib/domain";

const viewerId = "viewer-1";
const program: Program = { ...initialProgram, athleteId: viewerId, createdById: viewerId, sourceType: "self", contentType: "program", title: "Strength cycle", hasOwnRuns: false };
const run: ProgramRunSummary = {
  id: "run-1", programId: program.id, programVersionId: program.versionId, athleteId: viewerId, createdById: viewerId,
  title: "Strength cycle", contentType: "program", status: "in_progress", totalWorkouts: 4, scheduledWorkouts: 4, completedWorkouts: 1, completionPercent: 25,
  nextWorkout: { id: "slot-2", title: "Lower body", status: "scheduled", plannedDate: localDateOnly() }, createdAt: "2026-09-01T09:00:00Z",
};
const slot: ProgramRunWorkout = { id: "slot-2", runId: run.id, workoutId: "workout-2", title: "Lower body", position: 2, estimatedMinutes: 40, status: "scheduled", plannedDate: localDateOnly(), canEdit: true, prescriptionOverrides: {} };
function renderHome(overrides: Partial<ProgramsHomeProps> = {}) {
  const props: ProgramsHomeProps = {
    programs: [], programRuns: [], viewerId, source: "own", hasCoach: false,
    hasMore: false, loadingMore: false, loadError: "", hasMoreRuns: false, runsLoading: false, runsError: "", action: null,
    capabilitiesForProgram: () => ({ view: true, copyToOwn: true, edit: true, save: true, schedule: true, assign: true, provideInitialAssignmentDate: true, deleteOwn: true, archiveInstance: false }),
    onOpen: vi.fn(), onEdit: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), onSource: vi.fn(), onCreate: vi.fn(), onCreateWorkout: vi.fn(), onSetDates: vi.fn(), onOpenRun: vi.fn(), onSetRunDates: vi.fn(), onEndRun: vi.fn(), onRepeatRun: vi.fn(), onLoadMore: vi.fn(), onLoadMoreRuns: vi.fn(), ...overrides,
  };
  return { ...render(<ProgramsHome {...props} />), props };
}

describe("Unified Training", () => {
  it("keeps occurrence editors and another athlete's sources out of the home feed", () => {
    const sources = [program, {...program, id: "private", editableRunId: run.id},
      {...program, id: "frozen", programRunId: run.id}, {...program, id: "another-athlete", athleteId: "other"}];
    expect(trainingFeed(sources, [], viewerId, "all").map(item => item.id)).toEqual([`program:${program.id}`]);
  });

  it("sorts actual training by date, excludes source duplicates, and retains independent copies", () => {
    const tomorrow = { ...run, id: "tomorrow", title: "Tomorrow cycle", nextWorkout: { ...run.nextWorkout!, plannedDate: addCalendarDays(localDateOnly(), 1) } };
    const overdue = { ...run, id: "overdue", title: "Overdue cycle", nextWorkout: { ...run.nextWorkout!, plannedDate: addCalendarDays(localDateOnly(), -1) } };
    const source = { ...program, id: "no-date", title: "Anytime strength" };
    const feed = trainingFeed([program, source], [tomorrow, run, overdue, run], viewerId, "own");
    expect(feed.map((item) => item.title)).toEqual(["Overdue cycle", "Strength cycle", "Tomorrow cycle", "Anytime strength"]);
    expect(feed.map((item) => trainingDateSection(item, localDateOnly()))).toEqual(["Today and overdue", "Today and overdue", "Upcoming", "No date"]);
  });

  it("starts a newly created undated workout directly without a planning step", async () => {
    const user = userEvent.setup();
    const onStartProgram = vi.fn();
    const workout = { ...program, contentType: "quick_workout" as const, title: "Quick strength" };
    renderHome({ programs: [workout], onStartProgram });
    expect(within(screen.getByRole("region", { name: "No date" })).getByText("Quick strength")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Plan|Add to my training/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start workout: Quick strength" }));
    expect(onStartProgram).toHaveBeenCalledWith(workout, undefined);
  });

  it("keeps one program card and loads its individual workouts only on expansion", async () => {
    const user = userEvent.setup();
    const onLoadRunDetail = vi.fn().mockResolvedValue({ ...run, workouts: [slot] });
    const onStartRunWorkout = vi.fn();
    const onEditRunWorkout = vi.fn();
    renderHome({ programs: [program], programRuns: [run], onLoadRunDetail, onStartRunWorkout, onEditRunWorkout });
    expect(screen.getAllByText("Strength cycle")).toHaveLength(1);
    expect(screen.getByText("1/4 completed")).toBeVisible();
    expect(onLoadRunDetail).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Start workout: Strength cycle" }));
    expect(onStartRunWorkout).toHaveBeenCalledWith(run);
    await user.click(screen.getByRole("button", { name: "Show workouts" }));
    await user.click(await screen.findByRole("button", { name: "Edit Lower body" }));
    expect(onLoadRunDetail).toHaveBeenCalledOnce();
    expect(onEditRunWorkout).toHaveBeenCalledWith(run, slot);
    await user.click(screen.getByRole("button", { name: "Start Lower body" }));
    expect(onStartRunWorkout).toHaveBeenCalledWith(run, slot);
  });

  it("lets a source program start or edit a selected workout before dates are chosen", async () => {
    const user = userEvent.setup();
    const onStartProgram = vi.fn(), onEdit = vi.fn();
    const onLoadProgramDetail = vi.fn().mockResolvedValue(program);
    renderHome({ programs: [{ ...program, weeks: [], detailsLoaded: false, workoutCount: 4 }], onLoadProgramDetail, onStartProgram, onEdit });
    await user.click(screen.getByRole("button", { name: "Show workouts" }));
    const workout = program.weeks[0].workouts[0];
    await user.click(await screen.findByRole("button", { name: `Start ${workout.title}, workout 1` }));
    expect(onStartProgram.mock.calls[0][1]).toBe(workout.id);
    await user.click(screen.getByRole("button", { name: `Edit ${workout.title}, workout 1` }));
    expect(onEdit.mock.calls[0][1]).toBe(workout.id);
  });

  it("retains editing dates for a fully dated program", async () => {
    const user = userEvent.setup();
    const { props } = renderHome({ programRuns: [run] });
    await user.click(screen.getByText("More"));
    await user.click(screen.getByRole("button", { name: "Change dates for Strength cycle" }));
    expect(props.onSetRunDates).toHaveBeenCalledWith(run);
  });

  it("restores a skipped slot and keeps completed slots read-only", async () => {
    const user = userEvent.setup();
    const skipped = { ...slot, id: "skipped", title: "Skipped workout", status: "skipped" as const, canEdit: false };
    const completed = { ...slot, id: "done", title: "Finished workout", status: "completed" as const, canEdit: false, sessionId: "session-1" };
    const onRestoreRunWorkout = vi.fn();
    renderHome({ programRuns: [run], onLoadRunDetail: vi.fn().mockResolvedValue({ ...run, workouts: [skipped, completed] }), onStartRunWorkout: vi.fn(), onEditRunWorkout: vi.fn(), onRestoreRunWorkout });
    await user.click(screen.getByRole("button", { name: "Show workouts" }));
    await user.click(await screen.findByRole("button", { name: "Restore Skipped workout" }));
    expect(onRestoreRunWorkout).toHaveBeenCalledWith(run, skipped);
    expect(screen.queryByRole("button", { name: "Edit Finished workout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Finished workout" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View results for Finished workout" })).toBeVisible();
  });

  it("keeps active-session resume visible even while searching History", async () => {
    const user = userEvent.setup();
    const onResumeWorkout = vi.fn();
    renderHome({ activeWorkout: { title: "Current workout", programRunId: run.id }, onResumeWorkout });
    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.type(screen.getByRole("textbox", { name: "Search programs and workouts" }), "Unrelated");
    await user.click(within(screen.getByRole("region", { name: "Workout in progress" })).getByRole("button", { name: "Resume workout" }));
    expect(onResumeWorkout).toHaveBeenCalledOnce();
  });

  it("preserves completed results, finished-program repeat, and independent history pagination", async () => {
    const user = userEvent.setup();
    const ended = { ...run, status: "ended" as const, nextWorkout: undefined, endedAt: "2026-09-20T09:00:00Z" };
    const session = { id: "session-1", programRunId: run.id, workoutTitle: "Finished lower body", date: "2026-09-20", durationMinutes: 40, rpe: 0 };
    const onLoadCompleted = vi.fn(), onLoadMoreCompleted = vi.fn(), onOpenCompleted = vi.fn(), onLoadMoreRuns = vi.fn();
    const { props } = renderHome({ programRuns: [ended], completedSessions: [session], completedHasMore: true, hasMoreRuns: true, onLoadCompleted, onLoadMoreCompleted, onOpenCompleted, onLoadMoreRuns });
    expect(screen.queryByText("Finished lower body")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(onLoadCompleted).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "View results for Finished lower body" }));
    expect(onOpenCompleted).toHaveBeenCalledWith(session);
    await user.click(screen.getByText("More"));
    await user.click(screen.getByRole("button", { name: "Repeat Strength cycle" }));
    expect(props.onRepeatRun).toHaveBeenCalledWith(ended);
    expect(props.onEndRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Load older workouts" }));
    await user.click(screen.getByRole("button", { name: "Load more training" }));
    expect(onLoadMoreCompleted).toHaveBeenCalledOnce();
    expect(onLoadMoreRuns).toHaveBeenCalledOnce();
  });

  it("shows coach training once without offering assignment to other athletes", () => {
    const coachRun = { ...run, createdById: "coach-1" };
    renderHome({ source: "coach", hasCoach: true, programRuns: [run, coachRun, coachRun], onAssignRun: vi.fn() });
    expect(screen.getAllByText("Strength cycle")).toHaveLength(1);
    expect(screen.getByText(/From coach ·/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Assign Strength cycle to athletes" })).not.toBeInTheDocument();
  });

  it("offers a recoverable error when expanding workouts fails", async () => {
    const user = userEvent.setup();
    const onLoadRunDetail = vi.fn().mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue({ ...run, workouts: [slot] });
    renderHome({ programRuns: [run], onLoadRunDetail, onStartRunWorkout: vi.fn() });
    await user.click(screen.getByRole("button", { name: "Show workouts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Start Lower body" })).toBeVisible();
  });

  it("retains date changes on fully scheduled coach cards", async () => {
    const user = userEvent.setup(), onSchedule = vi.fn();
    render(<ProgramRunCompactCard run={run} onOpen={vi.fn()} onSchedule={onSchedule} onEnd={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Change dates for Strength cycle" }));
    expect(onSchedule).toHaveBeenCalledOnce();
  });

  it("combines personal and coach training in chronological order in All training", () => {
    const coach = { ...run, id: "coach-run", title: "Coach strength", createdById: "coach-1", nextWorkout: { ...run.nextWorkout!, plannedDate: addCalendarDays(localDateOnly(), -1) } };
    renderHome({ source: "all", hasCoach: true, programs: [{ ...program, id: "undated", title: "Anytime training" }], programRuns: [run, coach] });
    const dated = screen.getByRole("region", { name: "Today and overdue" });
    expect(within(dated).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Coach strength", "Strength cycle"]);
    expect(screen.getByText("Anytime training")).toBeVisible();
    expect(screen.getByRole("button", { name: "All training" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters coach workout history correctly before its older program page loads", async () => {
    const user = userEvent.setup();
    const session = { id: "session-from-coach", programRunId: "unloaded-run", workoutTitle: "Older coach workout", date: "2026-08-20", durationMinutes: 40, rpe: 0, sourceType: "coach" as const };
    renderHome({ source: "coach", hasCoach: true, programRuns: [], historicalRuns: [], completedSessions: [session] });
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("Older coach workout")).toBeVisible();
  });

  it("loads finished program history separately from active training pages", async () => {
    const user = userEvent.setup();
    const historical = { ...run, id: "historical", title: "Ended cycle", status: "ended" as const };
    const onLoadHistoryRuns = vi.fn(), onLoadMoreHistoryRuns = vi.fn(), onLoadMoreRuns = vi.fn();
    renderHome({ programRuns: [run], historicalRuns: [historical], historyRunsHasMore: true, onLoadHistoryRuns, onLoadMoreHistoryRuns, onLoadMoreRuns });
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("Ended cycle")).toBeVisible();
    expect(screen.queryByText("Strength cycle")).not.toBeInTheDocument();
    expect(onLoadHistoryRuns).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Load more training" }));
    expect(onLoadMoreHistoryRuns).toHaveBeenCalledOnce();
    expect(onLoadMoreRuns).not.toHaveBeenCalled();
  });

  it("restores an individual skipped workout without requiring a separate Next section", async () => {
    const user = userEvent.setup();
    const quick = { ...run, contentType: "quick_workout" as const, totalWorkouts: 1, completedWorkouts: 0, nextWorkout: undefined };
    const skipped = { ...slot, status: "skipped" as const };
    const onRestoreRunWorkout = vi.fn();
    renderHome({ programRuns: [quick], onLoadRunDetail: vi.fn().mockResolvedValue({ ...quick, workouts: [skipped] }), onRestoreRunWorkout });
    await user.click(screen.getByText("More"));
    await user.click(screen.getByRole("button", { name: "Restore Strength cycle" }));
    expect(onRestoreRunWorkout).toHaveBeenCalledWith(quick, skipped);
  });

  it("opens a completed program workout directly without requiring history to be loaded", async () => {
    const user = userEvent.setup();
    const completed = { ...slot, status: "completed" as const, canEdit: false, sessionId: "unloaded-session" };
    const onOpenRunWorkoutResults = vi.fn();
    renderHome({ programRuns: [run], onLoadRunDetail: vi.fn().mockResolvedValue({ ...run, workouts: [completed] }), onOpenRunWorkoutResults });
    await user.click(screen.getByRole("button", { name: "Show workouts" }));
    await user.click(await screen.findByRole("button", { name: "View results for Lower body" }));
    expect(onOpenRunWorkoutResults).toHaveBeenCalledWith(run, completed);
  });

  it("refreshes expanded workout dates when a later edit leaves the next summary unchanged", async () => {
    const user = userEvent.setup();
    const updatedSlot = { ...slot, title: "Updated later workout", plannedDate: addCalendarDays(localDateOnly(), 3) };
    const onLoadRunDetail = vi.fn().mockResolvedValueOnce({ ...run, workouts: [slot] }).mockResolvedValue({ ...run, workouts: [updatedSlot] });
    const { rerender, props } = renderHome({ programRuns: [run], onLoadRunDetail });
    await user.click(screen.getByRole("button", { name: "Show workouts" }));
    expect(await screen.findByText("3. Lower body")).toBeVisible();
    rerender(<ProgramsHome {...props} programRuns={[{ ...run }]} />);
    expect(await screen.findByText("3. Updated later workout")).toBeVisible();
    expect(onLoadRunDetail).toHaveBeenCalledTimes(2);
  });

  it("ignores an older expansion response after the run is refreshed", async () => {
    const user = userEvent.setup();
    let resolveOlder!: (detail: unknown) => void;
    const pending = new Promise(resolve => { resolveOlder = resolve; });
    const onLoadRunDetail = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ ...run, workouts: [{ ...slot, title: "Current workout" }] });
    const { rerender, props } = renderHome({ programRuns: [run], onLoadRunDetail });
    await user.click(screen.getByRole("button", { name: "Show workouts" }));
    rerender(<ProgramsHome {...props} programRuns={[{ ...run }]} />);
    expect(await screen.findByText("3. Current workout")).toBeVisible();
    await act(async () => resolveOlder({ ...run, workouts: [slot] }));
    expect(screen.queryByText("3. Lower body")).not.toBeInTheDocument();
    expect(screen.getByText("3. Current workout")).toBeVisible();
  });

  it("retries the failed completed history page rather than silently reloading page one", async () => {
    const user = userEvent.setup();
    const onLoadCompleted = vi.fn(), onLoadMoreCompleted = vi.fn();
    renderHome({ completedHasMore: true, completedError: "Older workouts could not be loaded", onLoadCompleted, onLoadMoreCompleted });
    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(onLoadMoreCompleted).toHaveBeenCalledOnce();
    expect(onLoadCompleted).toHaveBeenCalledOnce();
  });
});

