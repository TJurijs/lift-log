import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiftLogApp from "../../app/LiftLogApp";
import { ProgramMetadataDraftController } from "../../app/features/programs/useProgramMetadataDraft";
import { demoViewer } from "../../lib/auth";
import { demoWorkspace, initialProgram } from "../../lib/demo-data";
import type { LiftLogRepository } from "../../lib/repository";

afterEach(() => { window.history.replaceState({}, "", "/"); vi.unstubAllGlobals(); });

describe("program metadata saving", () => {
  it("serializes changes made during saving before allowing navigation", async () => {
    let release!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    const controller = new ProgramMetadataDraftController(save, 60_000);
    controller.select(initialProgram);
    controller.change("title", "Updated name");
    const flush = controller.flush();
    await Promise.resolve();
    controller.change("description", "Latest description");
    const navigate = vi.fn();
    controller.guard(navigate);
    expect(navigate).not.toHaveBeenCalled();
    release();
    await flush;
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toEqual({ title: "Updated name", description: "Latest description" });
    expect(controller.getSnapshot()?.status).toBe("saved");
    controller.dispose();
  });

  it("retains a failed draft and retries before a competing action", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue(undefined);
    const controller = new ProgramMetadataDraftController(save, 60_000);
    controller.select(initialProgram);
    controller.change("title", "Keep this name");
    await expect(controller.flush()).rejects.toThrow("Connection interrupted");
    expect(controller.getSnapshot()).toMatchObject({ title: "Keep this name", status: "error", error: "Connection interrupted" });
    const openWizard = vi.fn();
    controller.guard(openWizard);
    await waitFor(() => expect(openWizard).toHaveBeenCalledOnce());
    expect(save.mock.calls[1][1].title).toBe("Keep this name");
    controller.dispose();
  });

  it("saves the demo editor name before Back and preserves it when reopened", async () => {
    window.history.replaceState({}, "", "/#/program");
    vi.stubGlobal("scrollTo", vi.fn());
    const user = userEvent.setup();
    render(<LiftLogApp viewer={demoViewer} initialWorkspace={demoWorkspace} repository={null} onSignOut={vi.fn()} />);
    await user.click((await screen.findByText(initialProgram.title)).closest("button")!);
    fireEvent.change(await screen.findByRole("textbox", { name: "Program name" }), { target: { value: "Saved through Back" } });
    await user.click(screen.getByRole("button", { name: "Back to Programs" }));
    const renamed = await screen.findByText("Saved through Back");
    await user.click(renamed.closest("button")!);
    expect(await screen.findByRole("textbox", { name: "Program name" })).toHaveValue("Saved through Back");
  });

  it("blocks feature navigation when saving fails, then resumes after retry", async () => {
    window.history.replaceState({}, "", "/#/program");
    vi.stubGlobal("scrollTo", vi.fn());
    const user = userEvent.setup();
    const updateProgramTitle = vi.fn().mockRejectedValue(new Error("Offline: keep editing"));
    const repository = {
      listProgramSummaries: vi.fn().mockResolvedValue({ items: [initialProgram], hasMore: false }),
      listProgramRuns: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
      loadProgramDetail: vi.fn().mockResolvedValue(initialProgram),
      updateProgramTitle,
      updateProgramDescription: vi.fn().mockResolvedValue(undefined),
      searchExercises: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    } as unknown as LiftLogRepository;
    render(<LiftLogApp viewer={demoViewer} initialWorkspace={demoWorkspace} repository={repository} onSignOut={vi.fn()} />);
    await user.click((await screen.findByText(initialProgram.title)).closest("button")!);
    fireEvent.change(await screen.findByRole("textbox", { name: "Program name" }), { target: { value: "Unsaved but retained" } });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    await user.click(within(nav).getByRole("button", { name: "Exercises" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline: keep editing");
    expect(screen.getByRole("textbox", { name: "Program name" })).toHaveValue("Unsaved but retained");
    updateProgramTitle.mockResolvedValue(undefined);
    await user.click(within(nav).getByRole("button", { name: "Exercises" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Exercises" })).toBeVisible();
  });

  it("flushes metadata on browser Back before removing the editor", async () => {
    window.history.replaceState({}, "", "/#/program");
    vi.stubGlobal("scrollTo", vi.fn());
    const user = userEvent.setup();
    render(<LiftLogApp viewer={demoViewer} initialWorkspace={demoWorkspace} repository={null} onSignOut={vi.fn()} />);
    await user.click((await screen.findByText(initialProgram.title)).closest("button")!);
    fireEvent.change(await screen.findByRole("textbox", { name: "Program name" }), { target: { value: "Saved with browser Back" } });
    act(() => window.history.back());
    expect(await screen.findByRole("heading", { level: 1, name: "Programs" })).toBeVisible();
    expect(await screen.findByText("Saved with browser Back")).toBeVisible();
  });

  it("retains a failed editor draft before sign-out and signs out only after its retry saves", async () => {
    window.history.replaceState({}, "", "/#/program");
    vi.stubGlobal("scrollTo", vi.fn());
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const updateProgramTitle = vi.fn().mockRejectedValue(new Error("Offline: retain this draft"));
    const repository = {
      listProgramSummaries: vi.fn().mockResolvedValue({ items: [initialProgram], hasMore: false }),
      listProgramRuns: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
      loadProgramDetail: vi.fn().mockResolvedValue(initialProgram),
      updateProgramTitle,
      updateProgramDescription: vi.fn().mockResolvedValue(undefined),
      searchExercises: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    } as unknown as LiftLogRepository;
    render(<LiftLogApp viewer={demoViewer} initialWorkspace={demoWorkspace} repository={repository} onSignOut={onSignOut} />);
    await user.click((await screen.findByText(initialProgram.title)).closest("button")!);
    fireEvent.change(await screen.findByRole("textbox", { name: "Program name" }), { target: { value: "Keep before signing out" } });
    await user.click(screen.getByRole("button", { name: /^Sign out / }));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline: retain this draft");
    expect(screen.getByRole("textbox", { name: "Program name" })).toHaveValue("Keep before signing out");
    updateProgramTitle.mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: /^Sign out / }));
    await waitFor(() => expect(onSignOut).toHaveBeenCalledOnce());
    expect(updateProgramTitle).toHaveBeenLastCalledWith(initialProgram.id, "Keep before signing out");
  });
});
