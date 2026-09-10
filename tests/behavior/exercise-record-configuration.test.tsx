import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExerciseModal } from "../../app/features/authoring/ExerciseModal";
import { RecordConfiguration } from "../../app/features/authoring/FormatTrackingFields";
import { ExercisesView } from "../../app/features/exercises/ExercisesHome";
import { emptyExerciseLibraryFilters, entryModesForFormats, filterCompleteExerciseLibrary, trackingFiltersForExerciseSearch } from "../../app/features/exercises/exercise-library";
import type { Exercise } from "../../lib/domain";

const plank: Exercise = {
  id: "plank", name: "Plank", category: "Core", cue: "Hold a straight body line.",
  scope: "personal", defaultMode: "result", defaultFields: ["duration"],
};

describe("exercise recording setup", () => {
  it("creates timed exercises with one Record control and no automatic reps, weight or RPE", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExerciseModal exercise={null} onSave={onSave} onClose={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "Exercise name" }), "Plank");
    expect(screen.getByRole("combobox", { name: "Record" })).toHaveValue("repetitions");
    await user.selectOptions(screen.getByRole("combobox", { name: "Record" }), "duration");
    expect(screen.queryByRole("combobox", { name: "Format" })).not.toBeInTheDocument();
    await user.click(screen.getByText("Customize optional fields"));
    expect(screen.getByRole("checkbox", { name: "Weight" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "RPE" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Reps" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create exercise" }));
    expect(onSave).toHaveBeenCalledWith("Plank", "gym", "General", "result", ["duration"], "", []);
  });

  it("preserves existing optional metrics when opening and saving an exercise", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExerciseModal exercise={{ ...plank, defaultFields: ["duration", "load", "heartRate", "rpe"] }} onSave={onSave} onClose={vi.fn()} />);
    await user.click(screen.getByText("Customize optional fields"));
    for (const name of ["Weight", "Heart rate", "RPE"]) expect(screen.getByRole("checkbox", { name })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith("Plank", "gym", "Core", "result", ["duration", "load", "heartRate", "rpe"], plank.cue, []);
  });

  it("offers weight as an explicit reps preset and keeps deliberately selected RPE", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RecordConfiguration format="repetitions" value={["reps", "rpe"]} onChange={onChange} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Record" }), "weighted_repetitions");
    expect(onChange).toHaveBeenLastCalledWith("repetitions", ["reps", "load", "rpe"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Record" }), "distance");
    expect(onChange).toHaveBeenLastCalledWith("distance", ["distance", "duration", "rpe"]);
  });

  it("shows one recording summary on each library card", () => {
    render(<ExercisesView scope="personal" query="" filters={emptyExerciseLibraryFilters()} global={[]} personal={[plank]} copyingExerciseId={null} loading={false} hasMore={false} onQuery={vi.fn()} onFilters={vi.fn()} onOpen={vi.fn()} onCopy={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onLoadMore={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open Plank" })).toHaveTextContent("Time");
    expect(screen.getAllByText("Time")).toHaveLength(1);
    expect(screen.queryByText("Reps")).not.toBeInTheDocument();
  });

  it("finds time defaults regardless of single-result or repeated-set storage", () => {
    const filters = { ...emptyExerciseLibraryFilters(), formats: ["duration" as const] };
    expect(entryModesForFormats(filters.formats)).toEqual(["sets", "result"]);
    expect(trackingFiltersForExerciseSearch(filters)).toEqual(["duration"]);
    expect(filterCompleteExerciseLibrary([plank, { ...plank, id: "repeated-plank", defaultMode: "sets" }], "", filters)).toHaveLength(2);
  });
});
