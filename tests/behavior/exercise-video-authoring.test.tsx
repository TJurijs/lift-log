import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExerciseModal } from "../../app/features/authoring/ExerciseModal";
import type { Exercise } from "../../lib/domain";

const exercise: Exercise = { id: "complex", name: "Clean + jerk", category: "Weightlifting", discipline: "weightlifting", scope: "personal", cue: "Stay balanced.", defaultMode: "sets", defaultFields: ["reps", "load"] };

describe("custom exercise videos", () => {
  it("saves ordered labeled links and removes duplicate URLs", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExerciseModal exercise={exercise} onSave={onSave} onClose={vi.fn()} />);
    for (const [index, url, label] of [[1, "https://youtu.be/clean", "Power clean"], [2, "https://example.com/jerk", "Push jerk"], [3, "https://youtu.be/clean", "Duplicate"]] as const) {
      await user.click(screen.getByRole("button", { name: "Add video" }));
      await user.type(screen.getByRole("textbox", { name: `Video ${index} URL` }), url);
      await user.type(screen.getByRole("textbox", { name: `Video ${index} label optional` }), label);
    }
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave.mock.calls[0][6]).toEqual([{ url: "https://youtu.be/clean", label: "Power clean" }, { url: "https://example.com/jerk", label: "Push jerk" }]);
  });

  it("prefills a legacy video and allows explicitly removing every link", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExerciseModal exercise={{ ...exercise, videoUrl: "https://youtu.be/clean" }} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Video 1 URL" })).toHaveValue("https://youtu.be/clean");
    await user.click(screen.getByRole("button", { name: "Remove video 1" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave.mock.calls[0][6]).toEqual([]);
  });

  it("retains rows after URL validation and server errors for correction and retry", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValue(undefined);
    render(<ExerciseModal exercise={exercise} onSave={onSave} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add video" }));
    const url = screen.getByRole("textbox", { name: "Video 1 URL" });
    await user.type(url, "javascript:alert(1)");
    await user.type(screen.getByRole("textbox", { name: "Video 1 label optional" }), "Technique");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/https/);
    expect(url).toHaveValue("javascript:alert(1)");
    await user.clear(url);
    await user.type(url, "https://example.com/demo");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Network unavailable");
    expect(url).toHaveValue("https://example.com/demo");
    expect(screen.getByRole("textbox", { name: "Video 1 label optional" })).toHaveValue("Technique");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][6]).toEqual([{ url: "https://example.com/demo", label: "Technique" }]);
  });

  it("limits the editor to ten rows and preserves order after removal", async () => {
    const user = userEvent.setup();
    render(<ExerciseModal exercise={{ ...exercise, videoLinks: Array.from({ length: 10 }, (_, index) => ({ url: `https://example.com/${index + 1}` })) }} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add video" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove video 5" }));
    expect(screen.getByRole("button", { name: "Add video" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Video 5 URL" })).toHaveValue("https://example.com/6");
    expect(screen.queryByRole("textbox", { name: "Video 10 URL" })).not.toBeInTheDocument();
  });
});
