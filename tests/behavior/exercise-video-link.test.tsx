import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ExerciseVideoLink } from "../../app/exercise-video-link";

describe("exercise video link", () => {
  it("opens a muted inline YouTube demo from seven seconds", () => {
    render(
      <ExerciseVideoLink
        exerciseName="Snatch"
        url="https://www.youtube.com/watch?v=nJmtGVutszE"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Watch Snatch video" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const player = screen.getByTitle("Snatch exercise demonstration");
    expect(player).toHaveAttribute(
      "src",
      expect.stringMatching(
        /youtube-nocookie\.com\/embed\/nJmtGVutszE\?.*autoplay=1.*mute=1.*start=7.*playsinline=1.*controls=0.*enablejsapi=1/,
      ),
    );
    expect(player.getAttribute("src")).not.toContain("playlist=");
    expect(player.getAttribute("src")).not.toContain("loop=");
    expect(
      screen.getByRole("link", { name: "Open Snatch on YouTube" }),
    ).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=nJmtGVutszE",
    );
    expect(screen.queryByText("Exercise demo")).not.toBeInTheDocument();
    expect(screen.queryByText(/Muted · starts/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close exercise video" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not reserve space when an exercise has no demo", () => {
    const { container } = render(
      <ExerciseVideoLink exerciseName="Custom movement" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});


it("contains keyboard focus and returns it to the video opener", async () => {
  const user = userEvent.setup();
  render(<><button>Background action</button><ExerciseVideoLink exerciseName="Snatch" label="Video" url="https://www.youtube.com/watch?v=nJmtGVutszE" /></>);
  const opener = screen.getByRole("button", { name: "Watch Snatch video" });
  await user.click(opener);
  const close = screen.getByRole("button", { name: "Close exercise video" });
  expect(close).toHaveFocus();
  screen.getByRole("button", { name: "Background action" }).focus();
  expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
