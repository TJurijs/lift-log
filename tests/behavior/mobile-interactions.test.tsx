import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PlannedRpeSelect,
  RpeSelect,
  RpeChoiceButtons,
  scrollToAppTop,
} from "../../app/LiftLogApp";
import CalendarView from "../../app/features/calendar/CalendarView";
import type {
  CompletedSession,
  PlannedWorkout,
  ScheduledWorkout,
} from "../../lib/domain";
import { localDateOnly } from "../../lib/date-only";

function matchMedia(reduceMotion: boolean): typeof window.matchMedia {
  return vi.fn().mockImplementation((query: string) => ({
    matches: reduceMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function calendarFixtures(date: string) {
  const workout: PlannedWorkout = {
    id: "workout-1",
    programVersionId: "version-1",
    scheduledWorkoutId: "schedule-1",
    plannedDate: date,
    title: "Fixture workout",
    dayLabel: "Day 1",
    durationMinutes: 45,
    sections: [],
  };
  const schedule: ScheduledWorkout = {
    id: "schedule-1",
    programId: "program-1",
    programTitle: "Fixture program",
    programVersionId: "version-1",
    workoutId: workout.id,
    workoutTitle: workout.title,
    slotLabel: "Week 1 · Day 1",
    plannedDate: date,
    sequenceNumber: 1,
    status: "planned",
    sourceType: "self",
    workout,
    detailsLoaded: true,
  };
  const session: CompletedSession = {
    id: "session-1",
    programVersionId: "version-1",
    workoutId: workout.id,
    workoutTitle: "Completed fixture",
    date,
    durationMinutes: 42,
    rpe: 7,
  };
  return { schedule, session };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mobile and accessible interactions", () => {
  it("honors reduced-motion preference when scrolling after navigation", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("matchMedia", matchMedia(true));

    scrollToAppTop();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });

    vi.stubGlobal("matchMedia", matchMedia(false));
    scrollToAppTop();
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it("keeps calendar cells noninteractive and exposes native sibling actions", async () => {
    const user = userEvent.setup();
    const date = localDateOnly();
    const { schedule, session } = calendarFixtures(date);
    const onScheduleDay = vi.fn();
    const onRemoveSchedule = vi.fn();
    const onOpenPlan = vi.fn();
    const onOpenResults = vi.fn();
    const { container } = render(
      <CalendarView
        sessions={[session]}
        schedules={[schedule]}
        weekStartsOnSunday={false}
        canSchedule
        onNavigate={vi.fn()}
        onSchedule={vi.fn()}
        onScheduleDay={onScheduleDay}
        onMoveSchedule={vi.fn()}
        onRemoveSchedule={onRemoveSchedule}
        onOpenPlan={onOpenPlan}
        onOpenResults={onOpenResults}
      />,
    );

    expect(container.querySelector(".calendar-day[role='button']")).toBeNull();
    const selectDay = screen.getByRole("button", {
      name: `Show calendar items for ${date}`,
    });
    const cell = selectDay.closest(".calendar-day");
    expect(cell).not.toBeNull();
    expect(selectDay).toHaveAttribute("aria-pressed", "true");

    const directSchedule = within(cell as HTMLElement).getByRole("button", {
      name: `Schedule a workout on ${date}`,
    });
    const plannedEvent = (cell as HTMLElement).querySelector(
      ".calendar-events button.planned",
    );
    expect(directSchedule.contains(plannedEvent)).toBe(false);
    await user.click(directSchedule);
    expect(onScheduleDay).toHaveBeenCalledWith(date);

    const agenda = container.querySelector(".calendar-day-agenda");
    expect(agenda).not.toBeNull();
    expect(within(agenda as HTMLElement).getByText("Fixture workout")).toBeVisible();
    expect(within(agenda as HTMLElement).queryByText("Completed fixture")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show completed" }));
    expect(within(agenda as HTMLElement).getByText("Completed fixture")).toBeVisible();

    await user.click(
      (agenda as HTMLElement).querySelector(
        ".calendar-day-agenda-main.planned",
      ) as HTMLButtonElement,
    );
    expect(onOpenPlan).toHaveBeenCalledWith(schedule);

    await user.click(
      within(agenda as HTMLElement).getByRole("button", {
        name: "Remove Fixture workout from the calendar",
      }),
    );
    expect(onRemoveSchedule).toHaveBeenCalledWith(schedule.id);
  });

  it("exposes the selected session RPE as a pressed button", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RpeChoiceButtons value="7" onChange={onChange} />,
    );
    const moderate = screen.getByRole("button", {
      name: /RPE 7: Moderate/,
    });
    const hard = screen.getByRole("button", { name: /RPE 8: Hard/ });
    expect(moderate).toHaveAttribute("aria-pressed", "true");
    expect(hard).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(hard);
    expect(onChange).toHaveBeenCalledWith("8");
    rerender(<RpeChoiceButtons value="8" onChange={onChange} />);
    expect(hard).toHaveAttribute("aria-pressed", "true");
  });

  it("uses the same compact guided RPE menu for planned and actual effort", async () => {
    const user = userEvent.setup();
    const onPlannedChange = vi.fn();
    const onActualChange = vi.fn();
    render(
      <>
        <PlannedRpeSelect value="" onChange={onPlannedChange} />
        <RpeSelect disabled={false} value="" onChange={onActualChange} />
      </>,
    );

    const planned = screen.getByRole("button", { name: "Planned RPE" });
    const actual = screen.getByRole("button", { name: "Actual RPE" });

    await user.click(planned);
    expect(
      screen.getByText(/sets the intended difficulty/i),
    ).toBeVisible();
    const plannedEight = screen.getByRole("option", {
      name: /RPE 8: 2 left/,
    });
    await user.click(plannedEight);
    await user.click(actual);
    expect(
      screen.getByText(/shows how hard the set felt/i),
    ).toBeVisible();
    const actualSeven = screen.getByRole("option", {
      name: /RPE 7: 3 left/,
    });
    expect(actualSeven).toBeVisible();
    await user.click(actualSeven);
    expect(onPlannedChange).toHaveBeenCalledWith("8");
    expect(onActualChange).toHaveBeenCalledWith("7");
  });
});
