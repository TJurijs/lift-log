import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WorkoutExercisePicker from "../../app/features/authoring/WorkoutExercisePicker";
import type { Exercise } from "../../lib/domain";

const exercise: Exercise = {
  id: "squat", name: "Back squat", category: "Strength", cue: "", scope: "global",
  defaultMode: "sets", defaultFields: ["reps", "load"],
};

function setup(overrides: Partial<React.ComponentProps<typeof WorkoutExercisePicker>> = {}) {
  const props = {
    onSearch: vi.fn().mockResolvedValue([exercise]),
    onSelect: vi.fn().mockResolvedValue(undefined),
    onCreateCustom: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<WorkoutExercisePicker {...props} />);
  return props;
}

describe("workout exercise search and creation", () => {
  it("adds a selected catalog movement without creating a custom exercise", async () => {
    const props = setup();
    await userEvent.click(await screen.findByRole("button", { name: /Back squat/ }));
    expect(props.onSelect).toHaveBeenCalledWith(exercise);
    expect(props.onCreateCustom).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("creates a workout-only movement from a trimmed name even when matches exist", async () => {
    const props = setup();
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "  My squat  ");
    await userEvent.click(screen.getByRole("button", { name: "Add My squat to this workout" }));
    expect(props.onCreateCustom).toHaveBeenCalledExactlyOnceWith("My squat");
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("accepts Enter to create the typed movement and prevents duplicate submissions", async () => {
    let finish!: () => void;
    const props = setup({ onCreateCustom: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) });
    const input = screen.getByRole("textbox", { name: "Search exercises" });
    await userEvent.type(input, "Clean pull + hold{Enter}");
    fireEvent.submit(input.closest("form")!);
    expect(props.onCreateCustom).toHaveBeenCalledExactlyOnceWith("Clean pull + hold");
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("retains the name and keeps the picker open when creation fails", async () => {
    const props = setup({ onCreateCustom: vi.fn().mockRejectedValue(new Error("Workout is no longer editable")) });
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "My movement{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Workout is no longer editable");
    expect(screen.getByRole("textbox")).toHaveValue("My movement");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add My movement to this workout" })).toBeEnabled();
  });

  it("keeps workout-only creation available when catalog search fails", async () => {
    const props = setup({ onSearch: vi.fn().mockRejectedValue(new Error("Search unavailable")) });
    await userEvent.type(screen.getByRole("textbox"), "My movement");
    expect(await screen.findByRole("alert")).toHaveTextContent("Search unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Add My movement to this workout" }));
    expect(props.onCreateCustom).toHaveBeenCalledWith("My movement");
  });

  it("ignores an old search response after a new query", async () => {
    let resolveOld!: (value: Exercise[]) => void;
    const search = vi.fn((query: string) => query === "" ? new Promise<Exercise[]>((resolve) => { resolveOld = resolve; }) : Promise.resolve([]));
    setup({ onSearch: search });
    await waitFor(() => expect(search).toHaveBeenCalledWith(""));
    await userEvent.type(screen.getByRole("textbox"), "New movement");
    await waitFor(() => expect(search).toHaveBeenCalledWith("New movement"));
    await act(async () => { resolveOld([exercise]); });
    expect(screen.queryByRole("button", { name: /Back squat/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add New movement to this workout" })).toBeInTheDocument();
  });

  it("does not create an empty name or create implicitly when the picker closes", async () => {
    const props = setup();
    await userEvent.type(screen.getByRole("textbox"), "   {Enter}");
    expect(screen.queryByRole("button", { name: /to this workout/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onCreateCustom).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
