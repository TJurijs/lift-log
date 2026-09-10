import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PrescriptionModal from "../../app/features/authoring/PrescriptionModal";
import type { WorkoutItem } from "../../lib/domain";

const plank: WorkoutItem = {
  id: "plank-item", exerciseId: "plank", title: "Plank", cue: "Hold steady.",
  mode: "result", fields: ["duration"], prescription: {},
};

describe("prescribing recorded values", () => {
  it("preserves valid per-round time and distance targets through a notes-only save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const item: WorkoutItem = {
      ...plank, mode: "intervals", fields: ["rounds", "duration", "distance"],
      prescription: { rounds: 2, entries: [
        { workSeconds: 30, restSeconds: 0, durationMinutes: 0, distance: 0, distanceUnit: "m" },
        { workSeconds: 45, restSeconds: 15, durationMinutes: 0.75, distance: 250, distanceUnit: "m" },
      ] },
    };
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("textbox", { name: "Round plan, 1, time in seconds" })).toHaveValue("0");
    expect(screen.getByRole("textbox", { name: "Round plan, 2, distance" })).toHaveValue("0.25");
    await user.type(screen.getByPlaceholderText("Technique cues, tempo, substitutions…"), " Breathe evenly.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved.mode).toBe("intervals");
    expect(saved.prescription.entries).toHaveLength(2);
    expect(saved.prescription.entries).toMatchObject([
      { workSeconds: 30, restSeconds: 0, durationMinutes: 0, distance: 0, distanceUnit: "km" },
      { workSeconds: 45, restSeconds: 15, durationMinutes: 0.75, distance: 0.25, distanceUnit: "km" },
    ]);
    expect(saved.cue).toContain("Breathe evenly.");
  });

  it("keeps a movement sequence in the editor instead of silently saving it as empty reps", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PrescriptionModal item={{ ...plank, mode: "sets", fields: ["reps", "load"], prescription: { sets: 3 } }} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    await user.type(screen.getByRole("textbox", { name: "Repetitions" }), "2+1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Describe combinations such as 2 cleans \+ 1 jerk in Coaching notes/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Repetitions" })).toHaveValue("2+1");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
  it("converts three timed rounds into three timed sets with the same work, rest and RPE targets", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const item: WorkoutItem = {
      ...plank, mode: "intervals", fields: ["rounds", "duration", "rpe"],
      prescription: { rounds: 3, workSeconds: 30, restSeconds: 20, targetRpe: "7" },
    };
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Record" }), "duration");
    expect(screen.getByRole("spinbutton", { name: "Sets" })).toHaveValue(3);
    expect(screen.getByRole("textbox", { name: "Target time in seconds" })).toHaveValue("30");
    expect(screen.getByRole("textbox", { name: "Rest seconds" })).toHaveValue("20");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ mode: "sets", fields: ["duration", "rpe"], prescription: { sets: 3, durationMinutes: 0.5, restSeconds: 20, targetRpe: "7" } });
    expect(saved.prescription.entries).toHaveLength(3);
    expect(saved.prescription.entries?.every((entry) => entry.durationMinutes === 0.5 && entry.restSeconds === 20 && entry.targetRpe === "7" && entry.workSeconds === undefined && entry.rounds === undefined)).toBe(true);
  });

  it("preserves explicit times and per-row rests including zero when converting rounds", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const item: WorkoutItem = {
      ...plank, mode: "intervals", fields: ["rounds", "duration", "rpe"],
      prescription: { entries: [
        { durationMinutes: 0, workSeconds: 30, restSeconds: 0, targetRpe: "6" },
        { workSeconds: 45, restSeconds: 10, targetRpe: "8" },
        { durationMinutes: 1, workSeconds: 50, restSeconds: 20, targetRpe: "7" },
      ] },
    };
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Record" }), "duration");
    expect(screen.getByRole("textbox", { name: "Set plan, 1, time in seconds" })).toHaveValue("0");
    expect(screen.getByRole("textbox", { name: "Set plan, 2, time in seconds" })).toHaveValue("45");
    expect(screen.getByRole("textbox", { name: "Set plan, 3, time in seconds" })).toHaveValue("60");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved.prescription.entries).toMatchObject([
      { durationMinutes: 0, restSeconds: 0, targetRpe: "6" },
      { durationMinutes: 0.75, restSeconds: 10, targetRpe: "8" },
      { durationMinutes: 1, restSeconds: 20, targetRpe: "7" },
    ]);
  });

  it.each(["sets", "result"] as const)("preserves an existing zero rest target in %s mode", async (mode) => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const item: WorkoutItem = { ...plank, mode, prescription: { ...(mode === "sets" ? { sets: 2 } : {}), durationMinutes: 0.5, restSeconds: 0 } };
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("textbox", { name: "Rest seconds" })).toHaveValue("0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved.mode).toBe(mode);
    expect(saved.prescription.restSeconds).toBe(0);
    expect(saved.prescription.entries?.every((entry) => entry.restSeconds === 0)).toBe(true);
  });

  it("keeps only valid metrics when changing rounds to reps", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const item: WorkoutItem = { ...plank, mode: "intervals", fields: ["rounds", "duration", "distance", "heartRate", "rpe"], prescription: { rounds: 3, workSeconds: 30, durationMinutes: 1, distance: 100, distanceUnit: "m", restSeconds: 20, targetRpe: "7" } };
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Record" }), "repetitions");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ mode: "sets", fields: ["reps", "rpe"], prescription: { sets: 3, restSeconds: 20, targetRpe: "7" } });
    expect(saved.prescription.entries?.every((entry) => entry.durationMinutes === undefined && entry.distance === undefined && entry.workSeconds === undefined && entry.rounds === undefined)).toBe(true);
  });

  it("drops metric and rest targets when explicitly changing to instructions", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PrescriptionModal item={{ ...plank, prescription: { durationMinutes: 0.5, restSeconds: 20 } }} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Record" }), "instructions");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ mode: "none", fields: [], prescription: {} });
    expect(onSave.mock.calls[0][0].prescription).toEqual({});
  });

  it.each<{ name: string; item: WorkoutItem; countLabel: string }>([
    { name: "timed sets", countLabel: "Sets", item: { ...plank, mode: "sets", prescription: { entries: [{ durationMinutes: 0.5 }, { durationMinutes: 0.75 }] } } },
    { name: "repetition sets", countLabel: "Sets", item: { ...plank, mode: "sets", fields: ["reps"], prescription: { entries: [{ reps: "5" }, { reps: "8" }] } } },
    { name: "interval rounds", countLabel: "Rounds", item: { ...plank, mode: "intervals", fields: ["rounds", "duration"], prescription: { entries: [{ workSeconds: 20, restSeconds: 10 }, { workSeconds: 30, restSeconds: 20 }] } } },
  ])("preserves two $name stored without a shared count", async ({ item, countLabel }) => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("spinbutton", { name: countLabel })).toHaveValue(2);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved.mode).toBe(item.mode);
    expect(saved.prescription.entries).toHaveLength(2);
    expect(saved.prescription.entries).toMatchObject(item.prescription.entries!);
    expect(item.mode === "intervals" ? saved.prescription.rounds : saved.prescription.sets).toBe(2);
  });

  it("starts an unconfigured timed set with one entry", () => {
    render(<PrescriptionModal item={{ ...plank, mode: "sets" }} weightUnit="kg" onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("spinbutton", { name: "Sets" })).toHaveValue(1);
    expect(screen.getByRole("textbox", { name: "Target time in seconds" })).toHaveValue("");
  });

  it("plans three 30-second planks using Time and Sets without reps, weight or RPE", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PrescriptionModal item={plank} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("combobox", { name: "Record" })).toHaveValue("duration");
    expect(screen.queryByRole("checkbox", { name: /Per set values/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sets" }), { target: { value: "3" } });
    await user.type(screen.getByRole("textbox", { name: "Target time in seconds" }), "30");
    expect(screen.queryByRole("textbox", { name: "Repetitions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Target weight/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Target RPE")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ mode: "sets", fields: ["duration"], prescription: { sets: 3, durationMinutes: 0.5 } });
    expect(saved.prescription.entries).toHaveLength(3);
    for (const entry of saved.prescription.entries ?? []) {
      expect(entry.durationMinutes).toBe(0.5);
      expect(entry.reps).toBeUndefined();
      expect(entry.loadKg).toBeUndefined();
      expect(entry.targetRpe).toBeUndefined();
    }
  });

  it("keeps an existing zero target and converts a metre distance without changing its magnitude", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const item: WorkoutItem = {
      ...plank, title: "Carry", fields: ["distance", "duration", "load"],
      prescription: { distance: 250, distanceUnit: "m", durationMinutes: 0, loadKg: 0 },
    };
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("textbox", { name: "Target time in seconds" })).toHaveValue("0");
    expect(screen.getByRole("textbox", { name: "Target distance in kilometres" })).toHaveValue("0.25");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      mode: "result", fields: ["distance", "duration", "load"],
      prescription: { durationMinutes: 0, loadKg: 0, distance: 0.25, distanceUnit: "km" },
    });
  });

  it("changes a reps exercise to Time without carrying reps into the saved timed sets", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const item: WorkoutItem = { ...plank, mode: "sets", fields: ["reps"], prescription: { sets: 3, reps: "10" } };
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Record" }), "duration");
    expect(screen.getByRole("textbox", { name: "Target time in seconds" })).toHaveValue("");
    await user.type(screen.getByRole("textbox", { name: "Target time in seconds" }), "45");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ mode: "sets", fields: ["duration"], prescription: { sets: 3, durationMinutes: 0.75 } });
    expect(saved.prescription.reps).toBeUndefined();
    expect(saved.prescription.entries?.every((entry) => entry.durationMinutes === 0.75 && entry.reps === undefined)).toBe(true);
  });

  it("keeps the target editable when a plan with different set times is reduced to one set", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const item: WorkoutItem = {
      ...plank, mode: "sets",
      prescription: { sets: 3, entries: [{ durationMinutes: 0.5 }, { durationMinutes: 0.75 }, { durationMinutes: 1 }] },
    };
    render(<PrescriptionModal item={item} weightUnit="kg" onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sets" }), { target: { value: "1" } });
    expect(screen.queryByRole("checkbox", { name: /Per set values/ })).not.toBeInTheDocument();
    const input = screen.getAllByRole("textbox", { name: /time in seconds/i }).find((candidate) => !(candidate as HTMLInputElement).disabled);
    expect(input).toBeDefined();
    expect(input).toHaveValue("30");
    await user.clear(input!);
    await user.type(input!, "45");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved: WorkoutItem = onSave.mock.calls[0][0];
    expect(saved.prescription).toMatchObject({ sets: 1, durationMinutes: 0.75 });
    expect(saved.prescription.entries).toHaveLength(1);
    expect(saved.prescription.entries?.[0].durationMinutes).toBe(0.75);
  });
});
