import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ExerciseVideoLink } from "../../app/exercise-video-link";

const delayed = vi.hoisted(() => {
  let resolve!: (module: { default: () => React.ReactNode }) => void;
  const ready = new Promise<{ default: () => React.ReactNode }>((release) => { resolve = release; });
  return { ready, resolve, requested: vi.fn(), rendered: vi.fn() };
});

vi.mock("../../app/exercise-video-dialog", () => { delayed.requested(); return delayed.ready; });

it("loads the player only after opening and preserves closing/focus while the chunk is slow", async () => {
  const user = userEvent.setup();
  render(<ExerciseVideoLink exerciseName="Snatch" url="https://youtu.be/nJmtGVutszE" />);
  expect(delayed.requested).not.toHaveBeenCalled();
  const opener = screen.getByRole("button", { name: "Watch Snatch video" });
  await user.click(opener);
  expect(screen.getByRole("status")).toHaveTextContent("Loading video");
  expect(screen.getByRole("button", { name: "Close exercise video" })).toHaveFocus();
  await waitFor(() => expect(delayed.requested).toHaveBeenCalledOnce());
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  await act(async () => delayed.resolve({ default: () => { delayed.rendered(); return <iframe title="Loaded demonstration" />; } }));
  expect(delayed.rendered).not.toHaveBeenCalled();
  await user.click(opener);
  expect(await screen.findByTitle("Loaded demonstration")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close exercise video" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Close exercise video" }));
  expect(opener).toHaveFocus();
});
