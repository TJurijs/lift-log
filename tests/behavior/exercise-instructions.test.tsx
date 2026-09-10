import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LiftLogApp from "../../app/LiftLogApp";
import { demoViewer } from "../../lib/auth";
import { createExerciseRecordingDemoWorkspace } from "../../lib/demo-data";
import { workoutItemNotes } from "../../lib/domain";
import { completeDemoWorkout, createDemoWorkoutSession } from "../../app/features/active-workout/demo-workout";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/#/today");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

describe("exercise instructions during training", () => {
  it("shows both cue and complete combination instructions, with timed plank sets rather than interval checkboxes", async () => {
    const workspace = createExerciseRecordingDemoWorkspace();
    render(<LiftLogApp viewer={demoViewer} onSignOut={vi.fn()} repository={null} initialWorkspace={workspace} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start workout" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Session notes optional" })).toBeEnabled());
    const plank = screen.getByText("Plank").closest(".log-item") as HTMLElement;
    expect(within(plank).getByRole("textbox", { name: "Plank, set 1, time in seconds" })).toHaveValue("");
    expect(within(plank).queryByRole("button", { name: /Mark round/ })).not.toBeInTheDocument();
    expect(plank).toHaveTextContent("Keep your elbows below your shoulders and avoid letting your hips drop.");
    expect(plank).toHaveTextContent("Rest 30 seconds between sets.");
    const combination = screen.getByText("Power clean + push jerk").closest(".log-item") as HTMLElement;
    expect(combination).toHaveTextContent("Perform the movements in the order shown for each set.");
    expect(combination).toHaveTextContent("Each set: 2 power cleans, then 1 push jerk.");
    expect(combination).toHaveTextContent("2 + 1 = 3 reps per set.");
    expect(combination).toHaveTextContent("Complete 4 sets. RPE 6–7; rest 2–3 minutes after each set.");
    expect(combination).toHaveTextContent("These 4 jerks are additional to the 4 standalone jerks earlier in the workout.");
    expect(combination.querySelector(".exercise-note")?.textContent).toContain("\n");
    expect(within(combination).getByRole("textbox", { name: "Power clean + push jerk, set 1, reps" })).toHaveValue("");
    expect(within(combination).getByRole("textbox", { name: "Power clean + push jerk, set 4, reps" })).toHaveValue("");
    expect(within(combination).getByRole("button", { name: "Watch Power clean + push jerk: 1. Power clean" })).toBeVisible();
    fireEvent.click(within(combination).getByRole("button", { name: "Watch Power clean + push jerk: 2. Push jerk" }));
    const player = await screen.findByTitle("Power clean + push jerk — 2. Push jerk exercise demonstration");
    expect(player).toHaveAttribute("src", expect.stringContaining("/Om7vLD6x8W0?"));
    expect(player).toHaveAttribute("src", expect.stringContaining("start=0"));
    fireEvent.click(screen.getByRole("button", { name: "Close exercise video" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains ordered videos in completed demo history independently of later exercise edits", () => {
    const schedule = createExerciseRecordingDemoWorkspace().scheduledWorkouts[0];
    const session = createDemoWorkoutSession(schedule);
    const completed = completeDemoWorkout(session, schedule, { setLogs: session.setLogs, resultLogs: {}, sessionNote: "", sessionRpe: "" });
    const item = schedule.workout.sections[0].items.find((candidate) => candidate.id === "preview-combination")!;
    const original = structuredClone(item.videoLinks);
    item.videoLinks![0].url = "https://example.com/replacement";
    expect(completed.items.find((candidate) => candidate.title === item.title)?.videoLinks).toEqual(original);
  });

  it("does not repeat an instruction already included in the saved cue", () => {
    const targetText = "Each set: 2 power cleans, then 1 push jerk.";
    expect(workoutItemNotes({ cue: targetText, prescription: { targetText } })).toBe(targetText);
    expect(workoutItemNotes({ cue: `Keep the movements controlled.\n${targetText}`, prescription: { targetText } }))
      .toBe(`Keep the movements controlled.\n${targetText}`);
    expect(workoutItemNotes({ cue: "", prescription: { targetText } })).toBe(targetText);
  });
});
