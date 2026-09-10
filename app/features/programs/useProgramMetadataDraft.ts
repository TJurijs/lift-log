import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { Program } from "../../../lib/domain";

export type ProgramMetadata = { title: string; description: string };
export type ProgramMetadataState = ProgramMetadata & {
  status: "saved" | "unsaved" | "saving" | "error";
  error: string;
};
type SaveMetadata = (program: Program, metadata: ProgramMetadata) => Promise<void>;
type Draft = {
  program: Program;
  value: ProgramMetadataState;
  saved: ProgramMetadata;
  pending: Promise<void> | null;
  origin?: { url: string; state: unknown };
};
const keyFor = (program: Program) => `${program.id}:${program.versionId}`;
const equal = (left: ProgramMetadata, right: ProgramMetadata) =>
  left.title.trim() === right.title.trim() && left.description.trim() === right.description.trim();

/** Serializes metadata writes and keeps an unsaved draft alive until navigation succeeds. */
export class ProgramMetadataDraftController {
  private drafts = new Map<string, Draft>();
  private current: Draft | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: ProgramMetadataState | null = null;
  constructor(private saveMetadata: SaveMetadata, private delay = 400) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = this.current?.value ?? null;
    this.listeners.forEach((listener) => listener());
  }
  configure = (saveMetadata: SaveMetadata) => { this.saveMetadata = saveMetadata; };
  select(program: Program | null) {
    if (!program || program.versionStatus !== "draft") {
      this.current = null;
    } else {
      let draft = this.drafts.get(keyFor(program));
      if (!draft) {
        const metadata = { title: program.title, description: program.description };
        draft = { program, saved: metadata, value: { ...metadata, status: "saved", error: "" }, pending: null };
        this.drafts.set(keyFor(program), draft);
      } else if (!draft.pending && equal(draft.value, draft.saved)) {
        const metadata = { title: program.title, description: program.description };
        draft.saved = metadata;
        draft.value = { ...metadata, status: "saved", error: "" };
      }
      draft.program = program;
      this.current = draft;
    }
    this.emit();
  }
  hasPending = () => [...this.drafts.values()].some((draft) => Boolean(draft.pending) || !equal(draft.value, draft.saved));
  change = (field: keyof ProgramMetadata, value: string) => {
    const draft = this.current;
    if (!draft) return;
    if (!draft.origin && typeof window !== "undefined") draft.origin = { url: window.location.href, state: window.history.state };
    draft.value = { ...draft.value, [field]: value, status: "unsaved", error: "" };
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.delay);
  };
  private async saveDraft(draft: Draft): Promise<void> {
    if (draft.pending) return draft.pending;
    const operation = async () => {
      while (!equal(draft.value, draft.saved)) {
        const metadata = { title: draft.value.title.trim(), description: draft.value.description.trim() };
        if (!metadata.title) throw new Error("Enter a name before leaving this editor.");
        draft.value = { ...draft.value, status: "saving", error: "" };
        this.emit();
        await this.saveMetadata(draft.program, metadata);
        draft.saved = metadata;
      }
      draft.origin = undefined;
      draft.value = { ...draft.value, status: "saved", error: "" };
      this.emit();
    };
    // Set the lock before invoking a callback that can synchronously rerender.
    draft.pending = Promise.resolve().then(operation).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Changes could not be saved. Try again before leaving.";
      draft.value = { ...draft.value, status: "error", error: message };
      this.emit();
      throw error;
    }).finally(() => { draft.pending = null; });
    return draft.pending;
  }
  flush = async () => {
    clearTimeout(this.timer);
    for (const draft of this.drafts.values()) await this.saveDraft(draft);
  };
  /** Browser Back has already changed the address; keep a failed draft's editor reachable. */
  restoreEditingLocation = () => {
    const origin = [...this.drafts.values()].find((draft) => !equal(draft.value, draft.saved))?.origin;
    if (origin && typeof window !== "undefined") window.history.pushState(origin.state, "", origin.url);
  };
  guard = (action: () => void) => {
    if (!this.hasPending()) { action(); return; }
    void this.flush().then(action).catch(() => this.restoreEditingLocation());
  };
  dispose() { clearTimeout(this.timer); }
}

export function useProgramMetadataDraft(program: Program | null) {
  const [controller] = useState(() => new ProgramMetadataDraftController(async () => { throw new Error("The editor is not ready to save yet."); }));
  const value = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => { controller.select(program); }, [controller, program]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller.hasPending()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      controller.dispose();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [controller]);
  return { value, change: controller.change, flush: controller.flush, guard: controller.guard, configure: controller.configure };
}
