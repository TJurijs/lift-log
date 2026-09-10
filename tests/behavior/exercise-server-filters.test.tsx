import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiftLogApp from "../../app/LiftLogApp";
import { ExercisesView } from "../../app/features/exercises/ExercisesHome";
import { demoViewer } from "../../lib/auth";
import { demoWorkspace } from "../../lib/demo-data";
import type { Exercise } from "../../lib/domain";
import type { LiftLogRepository } from "../../lib/repository";

const backSquat: Exercise = {
  id: "exercise-1",
  name: "Back squat",
  category: "Strength",
  discipline: "gym",
  cue: "Stay balanced.",
  scope: "global",
  defaultMode: "sets",
  defaultFields: ["reps", "load", "rpe"],
};

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});

describe("server-backed exercise filters", () => {
  it("offers the complete taxonomy and treats supplied rows as authoritative", async () => {
    const user = userEvent.setup();
    const onFilters = vi.fn();
    const onQuery = vi.fn();
    const onLoadMore = vi.fn();

    render(
      <ExercisesView
        scope="global"
        query="snatch"
        filters={{
          disciplines: ["functional"],
          categories: [],
          formats: [],
          tracking: [],
        }}
        global={[backSquat]}
        personal={[]}
        copyingExerciseId={null}
        loading={false}
        hasMore
        onQuery={onQuery}
        onFilters={onFilters}
        onOpen={vi.fn()}
        onCopy={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onLoadMore={onLoadMore}
      />,
    );

    expect(screen.getByText("Back squat")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Filters/ }));

    expect(screen.getByRole("button", { name: "Bodybuilding" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Functional fitness" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Rounds + time" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Heart rate" })).toBeVisible();

    const functionalChip = screen
      .getAllByRole("button", { name: "Functional" })
      .find((button) => button.classList.contains("active"));
    expect(functionalChip).toBeDefined();
    await user.click(functionalChip as HTMLButtonElement);
    expect(onFilters).toHaveBeenLastCalledWith({
      disciplines: [],
      categories: [],
      formats: [],
      tracking: [],
    });
    expect(screen.getByText("Back squat")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Load more exercises" }),
    );
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("sends every active filter to the initial search and load-more request", async () => {
    const user = userEvent.setup();
    const cursor = { name: backSquat.name, id: backSquat.id };
    const searchExercises = vi.fn().mockResolvedValue({
      items: [backSquat],
      nextCursor: cursor,
    });
    const repository = {
      searchExercises,
    } as unknown as LiftLogRepository;

    window.history.replaceState(null, "", window.location.pathname);
    render(
      <LiftLogApp
        viewer={demoViewer}
        initialWorkspace={demoWorkspace}
        repository={repository}
        onSignOut={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Exercises" }));
    await waitFor(() =>
      expect(searchExercises).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "",
          scope: "global",
          disciplines: [],
          categories: [],
          modes: [],
          tracking: [],
          limit: 50,
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    const filterPanel = within(
      document.getElementById("exercise-filter-panel") as HTMLElement,
    );
    await user.click(filterPanel.getByRole("button", { name: "Functional" }));
    await user.click(filterPanel.getByRole("button", { name: "Bodybuilding" }));
    await user.click(filterPanel.getByRole("button", { name: "Rounds + time" }));
    await user.click(filterPanel.getByRole("button", { name: "Heart rate" }));

    const activeRequest = {
      query: "",
      scope: "global",
      disciplines: ["functional"],
      categories: ["Bodybuilding"],
      modes: ["intervals"],
      tracking: ["heartRate", "rounds", "duration"],
      limit: 50,
    };
    await waitFor(() =>
      expect(searchExercises).toHaveBeenCalledWith(
        expect.objectContaining(activeRequest),
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "Load more exercises" }),
    );
    await waitFor(() =>
      expect(searchExercises).toHaveBeenCalledWith({
        ...activeRequest,
        cursor,
      }),
    );

    searchExercises.mockResolvedValue({ items: [], nextCursor: undefined });
    await user.type(screen.getByRole("textbox", { name: "Search exercises" }), "press");
    await screen.findByRole("heading", { name: "No exercises match" });
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("textbox", { name: "Search exercises" })).toHaveValue("press");
    await waitFor(() =>
      expect(searchExercises).toHaveBeenLastCalledWith(expect.objectContaining({
        query: "press", disciplines: [], categories: [], modes: [], tracking: [],
      })),
    );

    await user.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(screen.getByRole("textbox", { name: "Search exercises" })).toHaveValue("");
    await waitFor(() =>
      expect(searchExercises).toHaveBeenLastCalledWith(expect.objectContaining({
        query: "", disciplines: [], categories: [], modes: [], tracking: [],
      })),
    );
  });
});

describe("exercise collection actions", () => {
  const props = {
    query: "",
    filters: { disciplines: [], categories: [], formats: [], tracking: [] },
    global: [],
    personal: [],
    copyingExerciseId: null,
    loading: false,
    hasMore: false,
    onQuery: vi.fn(),
    onFilters: vi.fn(),
    onLoadMore: vi.fn(),
  };

  it("opens the identity by keyboard and keeps secondary actions in a dismissible menu", async () => {
    const user = userEvent.setup();
    const exercise: Exercise = { ...backSquat, scope: "personal" };
    const onOpen = vi.fn(), onEdit = vi.fn(), onDelete = vi.fn();
    render(<ExercisesView {...props} scope="personal" personal={[exercise]} onOpen={onOpen} onCopy={vi.fn()} onEdit={onEdit} onDelete={onDelete} />);

    const identity = screen.getByRole("button", { name: "Open Back squat" });
    identity.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(exercise);

    const more = screen.getByLabelText("More actions for Back squat");
    await user.click(more);
    await user.keyboard("{Escape}");
    expect(more).toHaveFocus();
    expect(more.closest("details")).not.toHaveAttribute("open");
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Edit Back squat" }));
    expect(onEdit).toHaveBeenCalledWith(exercise);
    expect(more.closest("details")).not.toHaveAttribute("open");
    expect(more).toHaveFocus();

    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Delete Back squat" }));
    expect(onDelete).toHaveBeenCalledWith(exercise);
    expect(more.closest("details")).not.toHaveAttribute("open");
  });

  it("keeps copying a library exercise visible and prevents another click while copying", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const callbacks = { onCopy, onOpen: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
    const view = render(<ExercisesView {...props} {...callbacks} scope="global" global={[backSquat]} />);
    const copy = screen.getByRole("button", { name: "Copy Back squat to My exercises" });
    await user.click(copy);
    expect(onCopy).toHaveBeenCalledWith(backSquat);
    view.rerender(<ExercisesView {...props} {...callbacks} scope="global" global={[backSquat]} copyingExerciseId={backSquat.id} />);
    expect(copy).toBeDisabled();
    await user.click(copy);
    expect(onCopy).toHaveBeenCalledOnce();
  });
});
