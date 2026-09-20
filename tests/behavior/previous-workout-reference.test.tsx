import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPreviousWorkoutValuesForUser, usePreviousWorkoutValues } from "../../app/features/active-workout/usePreviousWorkoutValues";
import { createPreviousValuesDemoSession, createPreviousValuesDemoWorkspace, previousDemoWorkoutValues } from "../../app/features/active-workout/previous-workout-demo";
import LiftLogApp from "../../app/LiftLogApp";
import { demoViewer } from "../../lib/auth";
import type { PreviousWorkoutValues } from "../../lib/domain";

const reference: PreviousWorkoutValues = { sessionId: "previous", completedAt: "2026-09-07T12:00:00Z",
  items: { squat: { setLogs: [{ reps: "5", load: "37.5", rpe: "7" }], resultLog: {} } } };
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/#/today");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

describe("previous workout references", () => {
  it("rejects late responses after changing workouts or viewers", async () => {
    let resolveFirst!: (value: PreviousWorkoutValues | null) => void;
    const repository = { loadPreviousWorkoutValues: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(null) };
    const { result, rerender } = renderHook(({ viewerId, workoutId }) => usePreviousWorkoutValues({ repository, viewerId, workoutId, online: true }),
      { initialProps: { viewerId: "a", workoutId: "one" } });
    await waitFor(() => expect(repository.loadPreviousWorkoutValues).toHaveBeenCalledTimes(1));
    rerender({ viewerId: "b", workoutId: "two" });
    await waitFor(() => expect(repository.loadPreviousWorkoutValues).toHaveBeenCalledTimes(2));
    await act(async () => resolveFirst(reference));
    expect(result.current).toBeNull();
    expect(Object.keys(localStorage).some((key) => key.includes(":a:"))).toBe(false);
  });

  it("retains a validated reference offline, excludes the active session, and clears it on sign out", async () => {
    const repository = { loadPreviousWorkoutValues: vi.fn().mockResolvedValue(reference) };
    const props = { repository, viewerId: "athlete", workoutId: "workout", online: true };
    const first = renderHook(() => usePreviousWorkoutValues(props));
    await waitFor(() => expect(first.result.current).toEqual(reference));
    first.unmount();
    repository.loadPreviousWorkoutValues.mockClear();
    const offline = renderHook(({ viewerId, excludeSessionId }) => usePreviousWorkoutValues({ ...props, online: false, viewerId, excludeSessionId }),
      { initialProps: { viewerId: "athlete", excludeSessionId: undefined as string | undefined } });
    expect(offline.result.current).toEqual(reference);
    expect(repository.loadPreviousWorkoutValues).not.toHaveBeenCalled();
    offline.rerender({ viewerId: "another-athlete", excludeSessionId: undefined });
    expect(offline.result.current).toBeNull();
    offline.rerender({ viewerId: "athlete", excludeSessionId: "previous" });
    expect(offline.result.current).toBeNull();
    clearPreviousWorkoutValuesForUser("athlete");
    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it("shows previous values inside cells without saving them as today's actuals", async () => {
    const workspace = createPreviousValuesDemoWorkspace();
    const schedule = workspace.scheduledWorkouts[0];
    const previous = createPreviousValuesDemoSession(schedule);
    const squat = schedule.workout.sections.flatMap((section) => section.items).find((item) => item.title === "Back squat")!;
    expect(previousDemoWorkoutValues(schedule.workout, previous)?.items[squat.id].setLogs[0].load).toBe("37.5");
    render(<LiftLogApp viewer={demoViewer} onSignOut={vi.fn()} repository={null} initialWorkspace={workspace} initialDemoSessions={[previous]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start workout" }));
    const reps = await screen.findByLabelText("Back squat, set 1, reps");
    await waitFor(() => expect(reps).toBeEnabled());
    const load = screen.getByLabelText("Back squat, set 1, load in kg");
    expect(reps).toHaveValue("5");
    expect(load).toHaveValue("40");
    expect(load.closest(".ghost-value-cell")).toHaveTextContent("Last: 37.5");
    expect(screen.getByLabelText("Back squat, set 1, actual RPE")).toHaveTextContent("—");
    fireEvent.focus(load);
    expect(load).toHaveValue("40");
    fireEvent.change(load, { target: { value: "42.5" } });
    fireEvent.change(reps, { target: { value: "" } });
    expect(reps.closest(".ghost-value-cell")).toHaveTextContent("Last: 5");
    fireEvent.click(screen.getByRole("button", { name: "Finish and save session" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Finish and save session" })).not.toBeInTheDocument());
    expect(screen.queryByText("Finish with unrecorded results?")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Show completed" }));
    const history = screen.getByRole("region", { name: "Completed workouts" });
    fireEvent.click(within(history).getByRole("button", { name: /Workout results/ }));
    expect(await screen.findByText("42.5")).toBeVisible();
    expect(screen.queryByText("37.5")).not.toBeInTheDocument();
    expect(screen.queryByText(/Last:/)).not.toBeInTheDocument();
  });
});
