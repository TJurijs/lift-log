import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LiftLogApp from "../../app/LiftLogApp";
import { createDemoWorkoutSession } from "../../app/features/active-workout/demo-workout";
import * as workoutPersistence from "../../app/features/active-workout/useActiveWorkoutPersistence";
import { demoViewer } from "../../lib/auth";
import { localDateOnly } from "../../lib/date-only";
import { demoWorkspace, initialProgram } from "../../lib/demo-data";
import type { AthleteSummary, CompletedSessionDetail, Program, ProgramRunDetail, ScheduledWorkout, WorkspaceData } from "../../lib/domain";
import type { LiftLogRepository } from "../../lib/repository";

const originalWorkout = {
  ...initialProgram.weeks[0].workouts[0],
  id: "original-workout",
  title: "Strength session",
  sections: [{
    id: "original-section", title: "Exercises", kind: "main" as const,
    items: [{
      id: "original-squat", title: "Back squat", cue: "Keep a steady brace.",
      mode: "sets" as const, fields: ["reps", "load"] as const,
      prescription: { sets: 2, reps: "5", loadKg: 40 },
    }],
  }],
};

function workoutProgram(id: string, title: string): Program {
  return {
    ...initialProgram, id, title, versionId: `${id}-version`, activeWeek: 1,
    contentType: "quick_workout", detailsLoaded: true,
    weeks: [{
      id: `${id}-week`, index: 1, label: "Workouts",
      workouts: [{ ...originalWorkout, id: `${id}-workout`, title,
        sections: originalWorkout.sections.map(section => ({ ...section,
          items: section.items.map(item => ({ ...item, fields: [...item.fields] })),
        })),
      }],
    }],
  };
}

const source = workoutProgram("source", "Strength session");
const repeat = workoutProgram("repeat", "Strength session copy");
const completed: CompletedSessionDetail = {
  id: "completed-session", workoutId: source.weeks[0].workouts[0].id,
  programVersionId: source.versionId, workoutTitle: source.title,
  date: "2026-09-20", durationMinutes: 42, rpe: 7, note: "Completed safely", items: [],
};
const run: ProgramRunDetail = {
  id: "active-training", athleteId: demoViewer.id, createdById: demoViewer.id,
  programId: source.id, programVersionId: source.versionId, title: source.title,
  contentType: "quick_workout", status: "not_started", totalWorkouts: 1,
  scheduledWorkouts: 0, completedWorkouts: 0, completionPercent: 0,
  createdAt: "2026-09-20T09:00:00.000Z",
  nextWorkout: { id: "upcoming-slot", title: source.title, status: "unscheduled" },
  workouts: [{
    id: "upcoming-slot", runId: "active-training", workoutId: source.weeks[0].workouts[0].id,
    title: source.title, position: 0, estimatedMinutes: 50,
    status: "unscheduled", canEdit: true, prescriptionOverrides: {},
  }],
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => { resolve = done; });
  return { promise, resolve };
}

function repositoryFor(overrides: Partial<LiftLogRepository> = {}) {
  return {
    invalidatePrograms: vi.fn(),
    listProgramSummaries: vi.fn().mockResolvedValue({ items: [source], hasMore: false }),
    listProgramRuns: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    listCompletedSessionSummaries: vi.fn().mockResolvedValue({ items: [completed], hasMore: false }),
    loadCompletedSessionDetail: vi.fn().mockResolvedValue(completed),
    loadProgramDetail: vi.fn().mockResolvedValue(source),
    loadProgramForRun: vi.fn().mockResolvedValue({ ...source, versionStatus: "published" }),
    loadProgramRunDetail: vi.fn().mockResolvedValue(run),
    loadEditableProgram: vi.fn().mockResolvedValue(repeat),
    loadPreviousWorkoutValues: vi.fn().mockResolvedValue(null),
    copyCompletedWorkoutToOwn: vi.fn().mockResolvedValue(repeat.id),
    copyProgramRunToOwn: vi.fn().mockResolvedValue(repeat.id),
    copyProgramToOwn: vi.fn(),
    createProgramRuns: vi.fn(),
    ensureOwnTrainingRun: vi.fn(),
    startTrainingWorkout: vi.fn(),
    searchExercises: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    ...overrides,
  } as unknown as LiftLogRepository;
}

function renderApp(repository: LiftLogRepository, overrides: Partial<WorkspaceData> = {}) {
  return render(<LiftLogApp viewer={demoViewer} onSignOut={vi.fn()} repository={repository}
    initialWorkspace={{ ...demoWorkspace,
      programCatalog: [source], activeProgram: null, draftProgram: null,
      schedulablePrograms: [], schedulableProgramIds: [], scheduledWorkouts: [],
      completedSessions: [completed], programRuns: [], coachedAthletes: [], coachConnections: [],
      activeSession: null, ...overrides,
    }} />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/#/training");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("workout and program app workflows", () => {
  it("assigns the selected edited training from Coaching without reverting to its source", async () => {
    window.history.replaceState({}, "", "/#/coaching");
    const user = userEvent.setup();
    const editedRun: ProgramRunDetail = { ...run, title: "Adjusted strength training" };
    const effectiveWorkout = { ...source.weeks[0].workouts[0], id: "effective-workout", title: "Adjusted squat workout" };
    const effectiveProgram: Program = { ...source, title: editedRun.title, programRunId: editedRun.id,
      weeks: [{ ...source.weeks[0], workouts: [effectiveWorkout] }],
    };
    const athlete: AthleteSummary = { id: "athlete-1", name: "Athlete One", initials: "AO",
      detailsLoaded: true, programRuns: [], agenda: [],
    };
    const coaching = { coachedAthletes: [athlete], coachConnections: [], pendingCoachInvites: [], outgoingCoachInvites: [] };
    const repository = repositoryFor({
      listProgramRuns: vi.fn().mockImplementation((_athleteId, options) =>
        Promise.resolve({ items: options?.creatorScope === "coach" || options?.statusScope === "history" ? [] : [editedRun], hasMore: false })),
      loadCoachingWorkspace: vi.fn().mockResolvedValue(coaching),
      loadProgramForRun: vi.fn().mockResolvedValue(effectiveProgram),
      assignProgramRun: vi.fn().mockResolvedValue({ runIds: ["athlete-copy"] }),
    });
    renderApp(repository, { ...coaching, programRuns: [editedRun],
      coachingAccess: { hasCoach: false, coachedAthleteCount: 1, pendingInviteCount: 0 },
    });
    await user.click(await screen.findByRole("tab", { name: /My athletes/ }));
    await user.click((await screen.findAllByRole("button", { name: "Assign training" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Adjusted strength training/ }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Continue" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText(effectiveWorkout.title)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Assign workout" }));
    await waitFor(() => expect(repository.assignProgramRun).toHaveBeenCalledWith(
      editedRun.id, [athlete.id], [{ workoutId: effectiveWorkout.id }], expect.any(String),
    ));
    expect(repository.loadProgramForRun).toHaveBeenCalledWith(editedRun.id);
    expect(repository.createProgramRuns).not.toHaveBeenCalled();
  });

  it("keeps the selected second workout when opening a newly cloned editable version", async () => {
    const user = userEvent.setup();
    const first = source.weeks[0].workouts[0];
    const second = { ...first, id: "old-second", title: "Second workout" };
    const program: Program = {
      ...source, contentType: "program",
      weeks: [{ ...source.weeks[0], workouts: [first, second] }],
    };
    const editable: Program = {
      ...program, versionId: "fresh-draft",
      weeks: [{ ...program.weeks[0], id: "fresh-week", workouts: [
        { ...first, id: "new-first" }, { ...second, id: "new-second" },
      ] }],
    };
    const repository = repositoryFor({
      listProgramSummaries: vi.fn().mockResolvedValue({ items: [program], hasMore: false }),
      loadProgramDetail: vi.fn().mockResolvedValue(program),
      loadEditableProgram: vi.fn().mockResolvedValue(editable),
    });
    renderApp(repository, { programCatalog: [program] });
    await user.click(await screen.findByRole("button", { name: "Show workouts" }));
    await user.click(screen.getByRole("button", { name: "Edit Second workout, workout 2" }));
    expect(await screen.findByRole("button", { name: /2 Second workout/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Second workout" })).toBeVisible();
    expect(repository.loadEditableProgram).toHaveBeenCalledWith(program.athleteId, program.id);
  });

  it("publishes the new session's own logs while its workout detail is still loading", async () => {
    const user = userEvent.setup();
    const detail = deferred<ScheduledWorkout>();
    const workout = source.weeks[0].workouts[0];
    const schedule: ScheduledWorkout = {
      id: "slow-detail-schedule", programId: source.id, programVersionId: source.versionId,
      programTitle: source.title, workoutId: workout.id, workoutTitle: workout.title,
      plannedDate: localDateOnly(), slotLabel: workout.title, sequenceNumber: 1,
      status: "in_progress", workout, detailsLoaded: true,
    };
    const session = {
      ...createDemoWorkoutSession(schedule), id: "slow-detail-session",
      setLogs: { "original-squat": [{ reps: "11", load: "80", rpe: "" }] },
      sessionRpe: "", sessionNote: "New session only",
    };
    const persistence = vi.spyOn(workoutPersistence, "useActiveWorkoutPersistence");
    const repository = repositoryFor({
      startTrainingWorkout: vi.fn().mockResolvedValue(session),
      loadScheduledWorkoutDetail: vi.fn().mockReturnValue(detail.promise),
      reloadActiveSession: vi.fn().mockResolvedValue(session),
      saveSessionDraft: vi.fn().mockResolvedValue({ revision: 1 }),
    });
    renderApp(repository, { scheduledWorkouts: [{ ...schedule, id: "previous-form", status: "planned" }] });
    expect(persistence).toHaveBeenCalled();
    expect(persistence.mock.lastCall?.[0].snapshot.setLogs).not.toEqual(session.setLogs);
    await user.click(await screen.findByRole("button", { name: `Start workout: ${source.title}` }));
    await waitFor(() => expect(repository.startTrainingWorkout).toHaveBeenCalled());
    await waitFor(() => expect(repository.loadScheduledWorkoutDetail).toHaveBeenCalledWith(schedule.id));
    await waitFor(() => expect(persistence.mock.lastCall?.[0].snapshot.setLogs).toEqual(session.setLogs));
    expect(persistence.mock.lastCall?.[0].snapshot.resultLogs).toEqual(session.resultLogs);
    expect(persistence.mock.lastCall?.[0].snapshot.sessionNote).toBe(session.sessionNote);
    await act(async () => { detail.resolve(schedule); });
    expect(await screen.findByLabelText("Back squat, set 1, reps")).toHaveValue("11");
  });

  it("keeps a current catalog refresh when a later run-only refresh finishes first", async () => {
    const user = userEvent.setup();
    const catalog = deferred<Awaited<ReturnType<LiftLogRepository["listProgramSummaries"]>>>();
    const other = workoutProgram("other", "Other workout");
    const workout = other.weeks[0].workouts[0];
    const schedule: ScheduledWorkout = {
      id: "other-schedule", programId: other.id, programVersionId: other.versionId,
      programRunId: "other-run", programRunWorkoutId: "other-slot",
      programTitle: other.title, workoutId: workout.id, workoutTitle: workout.title,
      plannedDate: localDateOnly(), slotLabel: workout.title, sequenceNumber: 1,
      status: "planned", workout, detailsLoaded: true,
    };
    const otherRun: ProgramRunDetail = {
      ...run, id: "other-run", programId: other.id, programVersionId: other.versionId, title: other.title,
      scheduledWorkouts: 1,
      nextWorkout: { id: "other-slot", title: other.title, plannedDate: schedule.plannedDate, status: "scheduled" },
      workouts: [{ ...run.workouts[0], id: "other-slot", runId: "other-run", workoutId: workout.id,
        title: other.title, scheduledWorkoutId: schedule.id, plannedDate: schedule.plannedDate, status: "scheduled" }],
    };
    const session = { ...createDemoWorkoutSession(schedule), id: "overlap-session" };
    const repository = repositoryFor({
      listProgramSummaries: vi.fn().mockResolvedValueOnce({ items: [source], hasMore: false }).mockReturnValueOnce(catalog.promise),
      listProgramRuns: vi.fn().mockResolvedValue({ items: [otherRun], hasMore: false }),
      ensureOwnTrainingRun: vi.fn().mockResolvedValue({ runId: run.id }),
      loadProgramForRun: vi.fn().mockResolvedValue({ ...other, versionStatus: "published" }),
      loadProgramRunDetail: vi.fn().mockResolvedValue(otherRun),
      loadScheduledWorkoutDetail: vi.fn().mockResolvedValue(schedule),
      startOrResumeSession: vi.fn().mockResolvedValue(session),
      reloadActiveSession: vi.fn().mockResolvedValue(session),
      saveSessionDraft: vi.fn().mockResolvedValue({ revision: 1 }),
    });
    renderApp(repository, { programRuns: [otherRun] });
    await user.click(await screen.findByLabelText(`More actions for ${source.title}`));
    await user.click(screen.getByRole("button", { name: `Set dates for ${source.title}` }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(`Date for ${source.title}`), { target: { value: localDateOnly() } });
    await user.click(within(dialog).getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(repository.listProgramSummaries).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole("button", { name: `Open ${other.title}` }));
    await user.click(within(await screen.findByRole("region", { name: "Workout status" })).getByRole("button"));
    await user.click(await screen.findByRole("button", { name: "Start workout" }));
    await waitFor(() => expect(repository.listProgramRuns).toHaveBeenCalledTimes(3));
    await act(async () => { catalog.resolve({ items: [source, repeat], hasMore: false }); });
    await user.click(screen.getByRole("button", { name: "Training" }));
    expect(await screen.findByRole("button", { name: `Open ${repeat.title}` })).toBeVisible();
  });

  it("repeats a completed workout into an editable copy, then enables actions after Save", async () => {
    window.history.replaceState({}, "", "/#/training");
    const user = userEvent.setup();
    const repository = repositoryFor();
    renderApp(repository);
    await user.click(await screen.findByRole("tab", { name: "History" }));
    expect(repository.listProgramRuns).toHaveBeenCalledWith(undefined, {statusScope:"active",limit:50});
    await waitFor(()=>expect(repository.listProgramRuns).toHaveBeenCalledWith(undefined, {statusScope:"history",limit:25}));
    const history = screen.getByRole("region", { name: "Completed workouts" });
    await user.click(await within(history).findByRole("button", { name: `View results for ${completed.workoutTitle}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Repeat workout" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Repeat workout" }));
    expect(repository.copyCompletedWorkoutToOwn).toHaveBeenCalledWith(completed.id);
    expect(await screen.findByRole("textbox", { name: "Workout name" })).toHaveValue(repeat.title);
    expect(repository.loadEditableProgram).toHaveBeenCalledWith(demoViewer.id, repeat.id);
    expect(repository.copyProgramToOwn).not.toHaveBeenCalled();
    expect(repository.createProgramRuns).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start workout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set dates" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { level: 1, name: repeat.title })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Workout name" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start workout" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Set dates" })).toBeEnabled();
  });

  it("repeats the selected training occurrence rather than the current source workout", async () => {
    const user = userEvent.setup();
    const repository = repositoryFor({
      listProgramRuns: vi.fn().mockImplementation((_athleteId, options) =>
        Promise.resolve({ items: options?.creatorScope === "coach" ? [] : [run], hasMore: false })),
    });
    renderApp(repository, { programRuns: [run] });
    await user.click(await screen.findByLabelText(`More actions for ${run.title}`));
    await user.click(screen.getByRole("button", { name: `Repeat ${run.title}` }));
    expect(await screen.findByRole("textbox", { name: "Workout name" })).toHaveValue(repeat.title);
    expect(repository.loadProgramForRun).toHaveBeenCalledWith(run.id);
    expect(repository.copyProgramRunToOwn).toHaveBeenCalledWith(run.id);
    expect(repository.loadEditableProgram).toHaveBeenCalledWith(demoViewer.id, repeat.id);
    expect(repository.copyProgramToOwn).not.toHaveBeenCalled();
    expect(repository.createProgramRuns).not.toHaveBeenCalled();
  });

  it("opens an upcoming workout's private editor and returns to that training occurrence", async () => {
    const user = userEvent.setup();
    const hiddenEditor: Program = {
      ...workoutProgram("private-edit", "Adjusted strength session"),
      editableRunId: run.id, editableRunWorkoutId: run.workouts[0].id,
    };
    const repository = repositoryFor({
      listProgramRuns: vi.fn().mockImplementation((_athleteId, options) =>
        Promise.resolve({ items: options?.creatorScope === "coach" ? [] : [run], hasMore: false })),
      prepareProgramRunWorkoutEdit: vi.fn().mockResolvedValue(hiddenEditor),
    });
    renderApp(repository, { programRuns: [run] });
    await user.click(await screen.findByRole("button", { name: `Open ${run.title}` }));
    await user.click(await screen.findByRole("button", { name: `Edit ${source.title}` }));
    expect(repository.prepareProgramRunWorkoutEdit).toHaveBeenCalledWith(run.workouts[0].id);
    expect(await screen.findByRole("textbox", { name: "Workout name" })).toHaveValue(hiddenEditor.title);
    expect(screen.queryByRole("button", { name: "Start workout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set dates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repeat" })).not.toBeInTheDocument();
    vi.mocked(repository.loadProgramForRun).mockClear();
    await user.click(screen.getByRole("button", { name: "Back to Workout" }));
    expect(await screen.findByRole("button", { name: `Edit ${source.title}` })).toBeEnabled();
    expect(repository.loadProgramForRun).toHaveBeenCalledWith(run.id);
    expect(screen.queryByRole("textbox", { name: "Workout name" })).not.toBeInTheDocument();
  });

  it("starts an undated standalone workout directly and opens its prefilled recording screen", async () => {
    const user = userEvent.setup();
    const workout = source.weeks[0].workouts[0];
    const schedule: ScheduledWorkout = {
      id: "today-schedule", programId: source.id, programVersionId: source.versionId,
      programTitle: source.title, workoutId: workout.id, workoutTitle: workout.title,
      plannedDate: localDateOnly(), slotLabel: workout.title, sequenceNumber: 1,
      status: "in_progress", workout, detailsLoaded: true,
    };
    const session = { ...createDemoWorkoutSession(schedule), id: "started-session" };
    const repository = repositoryFor({
      startTrainingWorkout: vi.fn().mockResolvedValue(session),
      loadScheduledWorkoutDetail: vi.fn().mockResolvedValue(schedule),
      reloadActiveSession: vi.fn().mockResolvedValue(session),
      saveSessionDraft: vi.fn().mockResolvedValue({ revision: 1 }),
    });
    renderApp(repository);
    await user.click(await screen.findByRole("button", { name: `Start workout: ${source.title}` }));
    await waitFor(() => expect(repository.startTrainingWorkout).toHaveBeenCalledWith({programId:source.id,workoutId:workout.id,plannedDate:localDateOnly()}));
    expect(repository.createProgramRuns).not.toHaveBeenCalled();
    expect(repository.ensureOwnTrainingRun).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Finish and save session" })).toBeVisible();
    expect(screen.getByLabelText("Back squat, set 1, reps")).toHaveValue("5");
    expect(screen.getByLabelText("Back squat, set 1, load in kg")).toHaveValue("40");
  });

  it("sets a date on existing training without a separate Plan step", async () => {
    const user=userEvent.setup();
    const repository=repositoryFor({ensureOwnTrainingRun:vi.fn().mockResolvedValue({runId:run.id})});
    renderApp(repository);
    await user.click(await screen.findByLabelText(`More actions for ${source.title}`));
    await user.click(screen.getByRole("button", {name:`Set dates for ${source.title}`}));
    const dialog=await screen.findByRole("dialog");
    const input=await within(dialog).findByLabelText(`Date for ${source.title}`);
    expect(input).toHaveValue("");
    fireEvent.change(input,{target:{value:"2026-10-02"}});
    await user.click(within(dialog).getByRole("button",{name:"Save date"}));
    await waitFor(()=>expect(repository.ensureOwnTrainingRun).toHaveBeenCalledWith(source.id,[{workoutId:source.weeks[0].workouts[0].id,plannedDate:"2026-10-02"}],expect.any(String)));
    expect(repository.createProgramRuns).not.toHaveBeenCalled();
    expect(screen.queryByRole("button",{name:/Plan workout/})).not.toBeInTheDocument();
  });

  it.each(["scheduled", "in_progress"] as const)("starts or resumes a %s training slot without creating another occurrence", async (status) => {
    const user = userEvent.setup();
    const workout = source.weeks[0].workouts[0];
    const schedule: ScheduledWorkout = {
      id: "existing-schedule", programId: source.id, programVersionId: source.versionId,
      programRunId: run.id, programRunWorkoutId: run.workouts[0].id,
      programTitle: source.title, workoutId: workout.id, workoutTitle: workout.title,
      plannedDate: localDateOnly(), slotLabel: workout.title, sequenceNumber: 1,
      status: "in_progress", workout, detailsLoaded: true,
    };
    const scheduledRun: ProgramRunDetail = { ...run, scheduledWorkouts: 1,
      status: status === "scheduled" ? "not_started" : "in_progress",
      nextWorkout:{id:run.workouts[0].id,title:run.title,status,plannedDate:schedule.plannedDate},
      workouts: [{ ...run.workouts[0], status, scheduledWorkoutId: schedule.id, plannedDate: schedule.plannedDate }],
    };
    const session = { ...createDemoWorkoutSession(schedule), id: "existing-session" };
    const repository = repositoryFor({
      listProgramRuns: vi.fn().mockImplementation((_athleteId, options) =>
        Promise.resolve({ items: options?.creatorScope === "coach" || options?.statusScope === "history" ? [] : [scheduledRun], hasMore: false })),
      loadProgramRunDetail: vi.fn().mockResolvedValue(scheduledRun),
      loadScheduledWorkoutDetail: vi.fn().mockResolvedValue(schedule),
      startTrainingWorkout: vi.fn().mockResolvedValue(session),
      reloadActiveSession: vi.fn().mockResolvedValue(session),
      saveSessionDraft: vi.fn().mockResolvedValue({ revision: 1 }),
    });
    renderApp(repository, { programRuns: [scheduledRun] });
    await user.click(await screen.findByRole("button", { name: `Start workout: ${run.title}` }));
    expect(await screen.findByRole("button", { name: "Finish and save session" })).toBeVisible();
    expect(repository.startTrainingWorkout).toHaveBeenCalledWith({runWorkoutId:run.workouts[0].id,plannedDate:localDateOnly()});
    expect(repository.ensureOwnTrainingRun).not.toHaveBeenCalled();
    expect(repository.createProgramRuns).not.toHaveBeenCalled();
    expect(repository.copyProgramToOwn).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back to Training" }));
    expect(await screen.findByRole("region", { name: "Workout in progress" })).toBeVisible();
  });

  it("opens the athlete's next edited workout instead of falling back to the first workout", async () => {
    window.history.replaceState({}, "", "/#/coaching");
    const user = userEvent.setup();
    const first = source.weeks[0].workouts[0];
    const editedWorkout = { ...first, id: "edited-workout", title: "Adjusted second workout" };
    const assignedProgram: Program = { ...source, athleteId: "athlete-1", createdById: demoViewer.id,
      sourceType: "coach", versionStatus: "published", contentType: "program",
      weeks: [{ ...source.weeks[0], workouts: [first, editedWorkout] }],
    };
    const assignedRun: ProgramRunDetail = { ...run, athleteId: assignedProgram.athleteId,
      contentType: "program", status: "in_progress", totalWorkouts: 2, completedWorkouts: 1,
      scheduledWorkouts: 1, completionPercent: 50,
      workouts: [
        { ...run.workouts[0], status: "completed" },
        { ...run.workouts[0], id: "edited-slot", workoutId: "original-second-workout",
          effectiveWorkoutId: editedWorkout.id, title: editedWorkout.title, position: 1,
          status: "scheduled", scheduledWorkoutId: "athlete-schedule", plannedDate: localDateOnly() },
      ],
    };
    const athlete: AthleteSummary = { id: assignedProgram.athleteId, name: "Athlete One", initials: "AO",
      detailsLoaded: true, programRuns: [assignedRun], agenda: [],
    };
    const coaching = { coachedAthletes: [athlete], coachConnections: [], pendingCoachInvites: [], outgoingCoachInvites: [] };
    const repository = repositoryFor({
      loadCoachingWorkspace: vi.fn().mockResolvedValue(coaching),
      loadProgramForRun: vi.fn().mockResolvedValue(assignedProgram),
      loadProgramRunDetail: vi.fn().mockResolvedValue(assignedRun),
      startOrResumeSession: vi.fn(),
      loadScheduledWorkoutDetail: vi.fn(),
    });
    renderApp(repository, { ...coaching, coachingAccess: { hasCoach: false, coachedAthleteCount: 1, pendingInviteCount: 0 } });
    await user.click(await screen.findByRole("tab", { name: /My athletes/ }));
    await user.click(await screen.findByRole("button", { name: `Open ${run.title}` }));
    expect(await screen.findByRole("button", { name: new RegExp(`2 ${editedWorkout.title}`) })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: editedWorkout.title })).toBeVisible();
    expect(repository.loadProgramForRun).toHaveBeenCalledWith(assignedRun.id);
    expect(within(screen.getByRole("region", { name: "Workout status" })).getByRole("button")).toBeDisabled();
    expect(repository.loadScheduledWorkoutDetail).not.toHaveBeenCalled();
    expect(repository.startOrResumeSession).not.toHaveBeenCalled();
  });
});
