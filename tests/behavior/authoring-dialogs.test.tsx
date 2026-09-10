import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExerciseModal } from "../../app/features/authoring/ExerciseModal";
import { ProgramRow } from "../../app/features/programs/ProgramsHome";
import { initialProgram } from "../../lib/demo-data";

describe("authoring actions", () => {
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
    const onSchedule = vi.fn(), onEdit = vi.fn();
    render(<ProgramRow program={initialProgram} viewerId={initialProgram.athleteId} canEdit canDuplicate canDelete action={null} onOpen={vi.fn()} onEdit={onEdit} onDuplicate={vi.fn()} onDelete={vi.fn()} onSchedule={onSchedule} />);
    const useProgram = screen.getByRole("button", { name: `Use program: ${initialProgram.title}` });
    await user.click(useProgram);
    expect(onSchedule).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: `Edit ${initialProgram.title} program` })).not.toBeVisible();
    await user.click(screen.getByText("More"));
    await user.click(screen.getByRole("button", { name: `Edit ${initialProgram.title} program` }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.getByText("More").closest("details")).not.toHaveAttribute("open");
  });
});
