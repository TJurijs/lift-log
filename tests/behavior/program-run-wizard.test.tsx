import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ProgramRunWizard from "../../app/features/program-runs/ProgramRunWizard";
import type { AthleteSummary, PlannedWorkout, Program } from "../../lib/domain";

function workout(id: string, title: string): PlannedWorkout {
  return {
    id,
    programVersionId: "version-1",
    title,
    dayLabel: title,
    durationMinutes: 60,
    sections: [{ id: `${id}-items`, title: "Exercises", kind: "main", items: [] }],
  };
}

const program: Program = {
  id: "program-1",
  athleteId: "viewer-1",
  versionId: "version-1",
  versionStatus: "draft",
  title: "Balanced plan",
  description: "Two ordered sessions",
  phase: "Build",
  activeWeek: 1,
  weeks: [
    {
      id: "sequence-1",
      index: 1,
      label: "Workout sequence",
      workouts: [workout("workout-1", "Snatch"), workout("workout-2", "Jerk")],
    },
  ],
  ownerName: "Viewer One",
  createdById: "viewer-1",
  createdByName: "Viewer One",
  sourceType: "self",
  sourceLabel: "Own",
  contentType: "program",
};

const athletes: AthleteSummary[] = [
  {
    id: "athlete-1",
    name: "Athlete One",
    initials: "AO",
    assignedPrograms: [],
    agenda: [],
  },
  {
    id: "athlete-2",
    name: "Athlete Two",
    initials: "AT",
    assignedPrograms: [],
    agenda: [],
  },
];

describe("ProgramRunWizard", () => {
  it("keeps a cleared review date editable and submits it as an optional date", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<ProgramRunWizard mode="self" viewerId="viewer-1" viewerName="Viewer One"
      programs={[program]} athletes={[]} initialProgramId={program.id}
      onLoadProgram={vi.fn().mockResolvedValue(program)} onClose={vi.fn()} onCreate={onCreate} />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const date = screen.getByLabelText("Date for Snatch");
    const originalDate = (date as HTMLInputElement).value;
    fireEvent.change(date, { target: { value: "" } });
    expect(screen.getByLabelText("Date for Snatch")).toHaveValue("");
    fireEvent.change(date, { target: { value: originalDate } });
    expect(screen.getByLabelText("Date for Snatch")).toHaveValue(originalDate);
    fireEvent.change(date, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Start and schedule program" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      workoutDates: [
        { workoutId: "workout-1", plannedDate: undefined },
        { workoutId: "workout-2", plannedDate: expect.any(String) },
      ],
    }));
  });

  it("keeps the initial frequency and selected training days in one rhythm", async () => {
    const user = userEvent.setup();
    render(
      <ProgramRunWizard
        mode="self"
        viewerId="viewer-1"
        viewerName="Viewer One"
        programs={[program]}
        athletes={[]}
        initialProgramId={program.id}
        initialAthleteIds={["viewer-1"]}
        onLoadProgram={vi.fn().mockResolvedValue(program)}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    const frequency = screen.getByLabelText("Sessions per week");
    const trainingDays = screen
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"));
    expect(frequency).toHaveValue("2");
    expect(
      trainingDays.filter((button) => button.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(2);

    const firstSelected = trainingDays.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    expect(firstSelected).toBeDefined();
    await user.click(firstSelected!);
    expect(frequency).toHaveValue("1");

    const finalSelected = trainingDays.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    expect(finalSelected).toBeDefined();
    await user.click(finalSelected!);
    expect(frequency).toHaveValue("1");
    expect(
      trainingDays.filter((button) => button.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(1);
  });

  it("starts a flexible self run with every workout materialized but no dates", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ProgramRunWizard
        mode="self"
        viewerId="viewer-1"
        viewerName="Viewer One"
        programs={[program]}
        athletes={athletes}
        initialProgramId={program.id}
        initialAthleteIds={["viewer-1"]}
        onLoadProgram={vi.fn().mockResolvedValue(program)}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    expect(screen.getByRole("radio", { name: /Start and schedule/ })).toBeVisible();
    expect(screen.queryByRole("radio", { name: /Assign and schedule/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Set full schedule later/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getAllByText("Unscheduled")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Start program" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      programId: "program-1",
      athleteIds: ["viewer-1"],
      workoutDates: [
        { workoutId: "workout-1" },
        { workoutId: "workout-2" },
      ],
      idempotencyKey: expect.any(String),
    }));
  });

  it("assigns one scheduled run per selected athlete in the same flow", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ProgramRunWizard
        mode="coach"
        viewerId="coach-1"
        viewerName="Coach One"
        programs={[program]}
        athletes={athletes}
        initialProgramId={program.id}
        onLoadProgram={vi.fn().mockResolvedValue(program)}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Athlete One/ }));
    await user.click(screen.getByRole("button", { name: /Athlete Two/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("radio", { name: /Assign and schedule/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-09-07" },
    });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(
      screen.getByRole("button", { name: "Assign and schedule program" }),
    );

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      programId: "program-1",
      athleteIds: ["athlete-1", "athlete-2"],
      workoutDates: [
        { workoutId: "workout-1", plannedDate: "2026-09-07" },
        { workoutId: "workout-2", plannedDate: "2026-09-10" },
      ],
      idempotencyKey: expect.any(String),
    }));
  });

  it("uses the run model for a reusable standalone workout", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const quickWorkout: Program = {
      ...program,
      id: "quick-1",
      title: "Quick workout",
      contentType: "quick_workout",
      weeks: [
        {
          ...program.weeks[0],
          workouts: [workout("quick-workout-1", "Quick workout")],
        },
      ],
    };
    render(
      <ProgramRunWizard
        mode="self"
        viewerId="viewer-1"
        viewerName="Viewer One"
        programs={[quickWorkout]}
        athletes={[]}
        initialProgramId={quickWorkout.id}
        initialAthleteIds={["viewer-1"]}
        onLoadProgram={vi.fn().mockResolvedValue(quickWorkout)}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /Set full schedule later/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Start workout" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      programId: "quick-1",
      athleteIds: ["viewer-1"],
      workoutDates: [{ workoutId: "quick-workout-1" }],
      idempotencyKey: expect.any(String),
    }));
  });

  it("uses a stable idempotency key for an identical retry and a new key after changes", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error("Try again"));
    render(
      <ProgramRunWizard
        mode="self"
        viewerId="viewer-1"
        viewerName="Viewer One"
        programs={[program]}
        athletes={[]}
        initialProgramId={program.id}
        initialAthleteIds={["viewer-1"]}
        onLoadProgram={vi.fn().mockResolvedValue(program)}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /Set full schedule later/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Start program" }));
    expect(await screen.findByText("Try again")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start program" }));
    expect(onCreate).toHaveBeenCalledTimes(2);

    const firstKey = onCreate.mock.calls[0][0].idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(onCreate.mock.calls[1][0].idempotencyKey).toBe(firstKey);

    await screen.findByText("Try again");
    await user.click(screen.getByRole("button", { name: /Back/ }));
    await user.click(screen.getByRole("radio", { name: /Start and schedule/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Start and schedule program" }));
    expect(onCreate).toHaveBeenCalledTimes(3);
    expect(onCreate.mock.calls[2][0].idempotencyKey).not.toBe(firstKey);
  });

  it("does not describe an empty coach selection as zero athletes", () => {
    render(
      <ProgramRunWizard
        mode="coach"
        viewerId="coach-1"
        viewerName="Coach One"
        programs={[program]}
        athletes={[]}
        initialProgramId={program.id}
        onLoadProgram={vi.fn().mockResolvedValue(program)}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Assign training" })).toBeVisible();
    expect(screen.queryByText(/0 athletes/i)).not.toBeInTheDocument();
  });

  it("allows a start date to be cleared while the user is editing it", () => {
    render(
      <ProgramRunWizard
        mode="self"
        viewerId="viewer-1"
        viewerName="Viewer One"
        programs={[program]}
        athletes={[]}
        initialProgramId={program.id}
        initialAthleteIds={["viewer-1"]}
        onLoadProgram={vi.fn().mockResolvedValue(program)}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(() =>
      fireEvent.change(screen.getByLabelText("Start date"), {
        target: { value: "" },
      }),
    ).not.toThrow();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("does not create a run when edited dates reverse the workout sequence", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ProgramRunWizard
        mode="self"
        viewerId="viewer-1"
        viewerName="Viewer One"
        programs={[program]}
        athletes={[]}
        initialProgramId={program.id}
        initialAthleteIds={["viewer-1"]}
        onLoadProgram={vi.fn().mockResolvedValue(program)}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-09-07" },
    });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Date for Jerk"), {
      target: { value: "2026-09-06" },
    });
    await user.click(
      screen.getByRole("button", { name: "Start and schedule program" }),
    );

    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent(
      "Jerk is dated before Snatch. Workout dates must follow the program order.",
    );
    expect(onCreate).not.toHaveBeenCalled();
  });
});
