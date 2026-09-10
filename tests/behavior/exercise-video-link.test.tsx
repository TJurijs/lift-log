import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ExerciseVideoLink, ExerciseVideoLinks } from "../../app/exercise-video-link";

describe("exercise video link", () => {
  it("renders distinct labeled custom videos and starts a controllable player from zero", async () => {
    const user = userEvent.setup();
    render(<ExerciseVideoLinks exerciseName="Clean + jerk" videoLinks={[
      { url: "https://youtu.be/nJmtGVutszE", label: "Power clean" },
      { url: "https://www.youtube.com/watch?v=abc123", label: "Push jerk" },
    ]} />);
    expect(screen.getByRole("button", { name: "Watch Clean + jerk: 1. Power clean" })).toHaveTextContent("1. Power clean");
    await user.click(screen.getByRole("button", { name: "Watch Clean + jerk: 2. Push jerk" }));
    const player = await screen.findByTitle("Clean + jerk — 2. Push jerk exercise demonstration");
    const url = new URL(player.getAttribute("src")!);
    expect(url.hostname).toBe("www.youtube-nocookie.com");
    for (const [key, value] of Object.entries({ autoplay: "0", mute: "0", start: "0", controls: "1", enablejsapi: "0" })) expect(url.searchParams.get(key)).toBe(value);
    expect(url.searchParams.has("loop")).toBe(false);
    expect(player).toHaveAttribute("allowfullscreen");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Watch Clean + jerk: 2. Push jerk" })).toHaveFocus();
  });

  it("deduplicates and numbers unlabeled videos and uses safe external links outside YouTube", () => {
    render(<ExerciseVideoLinks exerciseName="Complex" videoLinks={[
      { url: "https://example.com/clean" }, { url: "https://example.com/clean" },
      { url: "https://example.com/jerk" }, { url: "javascript:alert(1)" },
      { url: "https://youtube.com.evil.example/watch?v=abc123" },
    ]} />);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Watch Complex: Video 1" })).toHaveAttribute("href", "https://example.com/clean");
    expect(screen.getByRole("link", { name: "Watch Complex: Video 2" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("does not render unsafe direct links or restore a legacy link after clearing the list", () => {
    const { container } = render(<><ExerciseVideoLink exerciseName="Unsafe" url="javascript:alert(1)" /><ExerciseVideoLinks exerciseName="Cleared" url="https://youtu.be/nJmtGVutszE" videoLinks={[]} /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it("preserves the old single-video accessibility through the wrapper", async () => {
    render(<ExerciseVideoLinks exerciseName="Snatch" url="https://youtu.be/nJmtGVutszE" label="Video" />);
    fireEvent.click(screen.getByRole("button", { name: "Watch Snatch video" }));
    expect((await screen.findByTitle("Snatch exercise demonstration")).getAttribute("src")).toContain("start=7");
  });

  it("opens a muted inline YouTube demo from seven seconds", async () => {
    render(
      <ExerciseVideoLink
        exerciseName="Snatch"
        url="https://www.youtube.com/watch?v=nJmtGVutszE"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Watch Snatch video" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const player = await screen.findByTitle("Snatch exercise demonstration");
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
