import { fireEvent, render, screen } from "@testing-library/react";
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
        /youtube-nocookie\.com\/embed\/nJmtGVutszE\?.*autoplay=1.*mute=1.*start=7.*playsinline=1.*controls=0.*loop=1/,
      ),
    );
    expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=nJmtGVutszE",
    );

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
