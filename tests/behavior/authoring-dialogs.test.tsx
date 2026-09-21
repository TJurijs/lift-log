import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExerciseModal } from "../../app/features/authoring/ExerciseModal";
import { WorkoutSettingsModal } from "../../app/features/authoring/WorkoutDialogs";
import { ProgramRow } from "../../app/features/programs/ProgramsHome";
import { initialProgram } from "../../lib/demo-data";

describe("authoring actions", () => {
  it.each([undefined, 45])("saves a workout without an estimate when duration is %s or cleared", async (durationMinutes) => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const workout = { ...initialProgram.weeks[0].workouts[0], durationMinutes };
    render(<WorkoutSettingsModal workout={workout} onSave={onSave} onClose={vi.fn()} />);

    const duration = screen.getByRole("spinbutton", { name: /Duration/ });
    expect(duration).toHaveValue(durationMinutes ?? null);
    if (durationMinutes !== undefined) await user.clear(duration);
    await user.click(screen.getByRole("button", { name: "Save workout" }));

    expect(onSave).toHaveBeenCalledWith(workout.title, undefined, "");
  });

  it("accepts an explicitly entered estimate while rejecting an invalid duration", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const workout = { ...initialProgram.weeks[0].workouts[0], durationMinutes: undefined };
    render(<WorkoutSettingsModal workout={workout} onSave={onSave} onClose={vi.fn()} />);

    const duration = screen.getByRole("spinbutton", { name: /Duration/ });
    fireEvent.change(duration, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Save workout" })).toBeDisabled();
    fireEvent.change(duration, { target: { value: "25" } });
    await user.click(screen.getByRole("button", { name: "Save workout" }));
    expect(onSave).toHaveBeenCalledWith(workout.title, 25, "");
  });

  it("submits an exercise once while awaiting the response and preserves errors for retry", async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    const onSave = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; })).mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ExerciseModal exercise={null} onSave={onSave} onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: "Exercise name" }), "Tempo squat");
    const save = screen.getByRole("button", { name: "Create exercise" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Exercise name" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => reject(new Error("Network unavailable")));
    expect(screen.getByRole("alert")).toHaveTextContent("Network unavailable");
    expect(screen.getByRole("textbox", { name: "Exercise name" })).toHaveValue("Tempo squat");
    await user.click(screen.getByRole("button", { name: "Create exercise" }));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("labels the primary program action and reveals secondary actions through More", async () => {
    const user = userEvent.setup();
    const onSetDates = vi.fn(), onEdit = vi.fn();
    render(<ProgramRow program={initialProgram} canEdit canDuplicate canDelete action={null} onOpen={vi.fn()} onEdit={onEdit} onDuplicate={vi.fn()} onDelete={vi.fn()} onSetDates={onSetDates} />);
    await user.click(screen.getByText("More"));
    await user.click(screen.getByRole("button", { name: `Set dates for ${initialProgram.title}` }));
    expect(onSetDates).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: `Edit ${initialProgram.title} program` })).not.toBeVisible();
    await user.click(screen.getByText("More"));
    await user.click(screen.getByRole("button", { name: `Edit ${initialProgram.title} program` }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.getByText("More").closest("details")).not.toHaveAttribute("open");
  });
});
