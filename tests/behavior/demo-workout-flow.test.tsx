import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LiftLogApp from "../../app/LiftLogApp";
import { demoViewer } from "../../lib/auth";
import { demoWorkspace } from "../../lib/demo-data";
import { loadCachedActiveWorkoutWorkspace } from "../../app/features/active-workout/useActiveWorkoutPersistence";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/#today");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

describe("demo workout lifecycle", () => {
  it.each([false, true])("finishes planned values directly and preserves a removed final set (removed: %s)", async (removeOptionalSet) => {
    const schedule = structuredClone(demoWorkspace.scheduledWorkouts[0]);
    schedule.workout.sections = [{ id: "planned-work", title: "Exercises", items: [
      { id: "planned-squat", title: "Planned squat", cue: "", mode: "sets", fields: ["reps", "load", "rpe"], prescription: { sets: 2, reps: "5", loadKg: 40, targetRpe: "8" } },
      { id: "planned-hold", title: "Planned hold", cue: "", mode: "sets", fields: ["duration"], prescription: { sets: 2, durationMinutes: 0.5 } },
      { id: "optional-curls", title: "Optional curls", cue: "", mode: "sets", fields: ["reps", "load"], prescription: { sets: 1, reps: "7", loadKg: 20 } },
    ] }];
    render(<LiftLogApp viewer={demoViewer} onSignOut={vi.fn()} repository={null} initialWorkspace={{ ...demoWorkspace, activeSession: null, scheduledWorkouts: [schedule], completedSessions: [] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start workout" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Session notes optional" })).toBeEnabled());
    expect(screen.getByLabelText("Planned squat, set 1, reps")).toHaveValue("5");
    expect(screen.getByLabelText("Planned squat, set 2, load in kg")).toHaveValue("40");
    expect(screen.getByLabelText("Planned hold, set 1, time in seconds")).toHaveValue("30");
    if (removeOptionalSet) {
      const optional = screen.getByText("Optional curls").closest(".log-item") as HTMLElement;
      const remove = within(optional).getByRole("button", { name: "Remove set 1" });
      expect(remove).toBeEnabled();
      fireEvent.click(remove);
      expect(within(optional).getByText("No sets · skipped")).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "Finish and save session" }));
    expect(screen.queryByRole("button", { name: "Finish without those results" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Show completed" }));
    const history = screen.getByRole("region", { name: "Completed workouts" });
    fireEvent.click(within(history).getByRole("button", { name: new RegExp(schedule.workoutTitle) }));
    expect(await screen.findAllByLabelText("5 reps · 40 kg")).toHaveLength(2);
    const hold = screen.getByText("Planned hold").closest(".calendar-detail-section") as HTMLElement;
    expect(hold.querySelectorAll(".completed-log-entry")).toHaveLength(2);
    expect(within(hold).getAllByText("30 sec")).toHaveLength(2);
    const optional = screen.getByText("Optional curls").closest(".calendar-detail-section") as HTMLElement;
    expect(optional.querySelectorAll(".completed-log-entry")).toHaveLength(removeOptionalSet ? 0 : 1);
    if (removeOptionalSet) expect(within(optional).getByText("No values were recorded")).toBeVisible();
    else expect(within(optional).getByLabelText("7 reps · 20 kg")).toBeVisible();
  });

  it("starts, logs, finishes, and opens the saved results with no repository", async () => {
    const user = userEvent.setup();
    const schedule = demoWorkspace.scheduledWorkouts[0];
    const item = schedule.workout.sections.flatMap((section) => section.items).find((candidate) => candidate.mode === "sets")!;
    render(<LiftLogApp viewer={demoViewer} onSignOut={vi.fn()} repository={null} initialWorkspace={{ ...demoWorkspace, activeSession: null, scheduledWorkouts: [schedule], completedSessions: [] }} />);
    await user.click(await screen.findByRole("button", { name: "Start workout" }));
    const note = await screen.findByRole("textbox", { name: "Session notes optional" });
    await waitFor(() => expect(note).toBeEnabled());
    await user.type(note, "Demo session completed");
    await user.clear(screen.getByLabelText(`${item.title}, set 1, load in kg`));
    await user.type(screen.getByLabelText(`${item.title}, set 1, load in kg`), "72.5");
    await user.click(screen.getByRole("button", { name: "Finish and save session" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Finish and save session" })).not.toBeInTheDocument());
    expect(await loadCachedActiveWorkoutWorkspace(demoViewer)).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Show completed" }));
    const history = screen.getByRole("region", { name: "Completed workouts" });
    await user.click(within(history).getByRole("button", { name: new RegExp(schedule.workoutTitle) }));
    expect(await screen.findByText("Demo session completed")).toBeVisible();
    expect(screen.getByText("72.5")).toBeVisible();
  });

  it("can set a demo workout back to scheduled and start again with fresh entries", async () => {
    const schedule = demoWorkspace.scheduledWorkouts[0];
    render(<LiftLogApp viewer={demoViewer} onSignOut={vi.fn()} repository={null} initialWorkspace={{ ...demoWorkspace, activeSession: null, scheduledWorkouts: [schedule], completedSessions: [] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start workout" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Session notes optional" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "Session notes optional" }), { target: { value: "Discard with reset" } });
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    fireEvent.click(screen.getByLabelText(`More actions for ${schedule.workout.title}`));
    fireEvent.click(screen.getByRole("button", { name: "Set back to scheduled" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start workout" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Session notes optional" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "Session notes optional" })).toHaveValue("");
  });
});
