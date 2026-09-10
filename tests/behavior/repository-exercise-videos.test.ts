import { describe, expect, it, vi } from "vitest";
import type { Exercise, ExerciseVideoLink } from "../../lib/domain";
import { LiftLogRepository } from "../../lib/repository";

const links = [{ url: "https://example.com/front", label: "Front" }, { url: "https://example.com/side", label: "Side" }];
const input = { name: "Custom movement", category: "Strength", cue: "Keep control", mode: "sets" as const };

function writer(rpc?: ReturnType<typeof vi.fn>) {
  const writes: Record<string, unknown>[] = [];
  let saved = { id: "exercise", scope: "personal", owner_id: "athlete", video_url: "https://legacy.example.com/", video_links: null, ...input } as Record<string, unknown>;
  const query = {
    insert(value: Record<string, unknown>) { writes.push(value); saved = { ...saved, ...value }; return query; },
    update(value: Record<string, unknown>) { writes.push(value); saved = { ...saved, ...value }; return query; },
    select: () => query, eq: () => query,
    single: async () => ({ data: saved, error: null }),
    maybeSingle: async () => ({ data: saved, error: null }),
  };
  const from = vi.fn(() => query);
  return { writes, from, repository: new LiftLogRepository({ from, rpc } as never, "athlete", "Athlete") };
}

function plannedContent(videoLinks: ExerciseVideoLink[], schedule: boolean) {
  const workout = { id: "workout", title: "Workout", estimatedMinutes: 20, sections: [{ id: "section", title: "Exercises", items: [{ id: "item", name: "Exercise", cue: "", entryMode: "sets", trackingFields: ["reps"], videoLinks, prescribedEntries: [] }] }] };
  const program = { id: "program", programId: "program", athleteId: "athlete", createdById: "athlete", versionId: "version", versionStatus: "published", title: "Program", weeks: [{ id: "week", workouts: [workout] }] };
  return schedule ? { id: "schedule", programId: "program", programVersionId: "version", programTitle: "Program", workoutId: "workout", status: "planned", workout } : program;
}

function readPlannedVideos(repository: LiftLogRepository, kind: string) {
  if (kind === "schedule") return repository.loadScheduledWorkoutDetail("schedule").then((value) => value?.workout.sections[0].items[0].videoLinks);
  const program = kind === "run" ? repository.loadProgramForRun("run") : repository.getProgramVersionDetail({ programId: "program", versionId: "version" });
  return program.then((value) => value?.weeks[0].workouts[0].sections[0].items[0].videoLinks);
}

describe("repository exercise videos", () => {
  it.each(["run", "version", "schedule"])("refreshes cached %s media after an explicit video update without reloading history", async (kind) => {
    let current: ExerciseVideoLink[] = links;
    const rpc = vi.fn(async () => ({ data: plannedContent(current, kind === "schedule"), error: null }));
    const { repository } = writer(rpc);
    const history = vi.fn().mockResolvedValue({ id: "completed", items: [{ videoLinks: links }] });
    Object.assign(repository, { loadCompletedSessionDetailUncached: history });
    await repository.loadCompletedSessionDetail("completed");
    expect(await readPlannedVideos(repository, kind)).toEqual(links);
    await readPlannedVideos(repository, kind);
    expect(rpc).toHaveBeenCalledTimes(1);

    current = [{ url: "https://example.com/new", label: "Updated view" }];
    await repository.updatePersonalExercise("exercise", { ...input, videoLinks: current });
    expect(await readPlannedVideos(repository, kind)).toEqual(current);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(await repository.loadCompletedSessionDetail("completed")).toEqual({ id: "completed", items: [{ videoLinks: links }] });
    expect(history).toHaveBeenCalledTimes(1);
  });

  it.each(["run", "version", "schedule"])("prevents a pending %s load from restoring old media after videos are cleared", async (kind) => {
    let resolveOld!: (value: { data: ReturnType<typeof plannedContent>; error: null }) => void;
    const pending = new Promise<{ data: ReturnType<typeof plannedContent>; error: null }>((resolve) => { resolveOld = resolve; });
    const rpc = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ data: plannedContent([], kind === "schedule"), error: null });
    const { repository } = writer(rpc);
    const original = readPlannedVideos(repository, kind);
    const follower = readPlannedVideos(repository, kind);
    await repository.updatePersonalExercise("exercise", { ...input, videoLinks: [] });
    resolveOld({ data: plannedContent(links, kind === "schedule"), error: null });
    expect(await Promise.all([original, follower])).toEqual([[], []]);
    expect(await readPlannedVideos(repository, kind)).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("also invalidates planned media for a legacy videoUrl-only edit", async () => {
    let current: ExerciseVideoLink[] = links;
    const rpc = vi.fn(async () => ({ data: plannedContent(current, false), error: null }));
    const { repository } = writer(rpc);
    await readPlannedVideos(repository, "version");
    current = [{ url: "https://example.com/legacy-new" }];
    await repository.updatePersonalExercise("exercise", { ...input, videoUrl: current[0].url });
    expect(await readPlannedVideos(repository, "version")).toEqual(current);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("creates ordered labeled links and projects the first URL for older readers", async () => {
    const { repository, writes } = writer();
    const exercise = await repository.createPersonalExercise({ ...input, videoLinks: links });
    expect(writes[0]).toMatchObject({ video_links: links, video_url: links[0].url });
    expect(exercise).toMatchObject({ videoLinks: links, videoUrl: links[0].url });
  });

  it("copies every normalized link and label when a shared exercise is copied to personal", async () => {
    const { repository, writes } = writer();
    const source = { ...input, videoUrl: links[0].url, videoLinks: links };
    await repository.createPersonalExercise(source);
    expect(writes[0].video_links).toEqual(links);
  });

  it("clears links explicitly but leaves both video columns untouched when omitted", async () => {
    const { repository, writes } = writer();
    await repository.updatePersonalExercise("exercise", input);
    expect(writes[0]).not.toHaveProperty("video_url");
    expect(writes[0]).not.toHaveProperty("video_links");
    const cleared = await repository.updatePersonalExercise("exercise", { ...input, videoLinks: [] });
    expect(writes[1]).toMatchObject({ video_url: null, video_links: [] });
    expect(cleared.videoLinks).toEqual([]);
    expect(cleared.videoUrl).toBeUndefined();
  });

  it("keeps legacy-only edits available without implying a custom list", async () => {
    const { repository, writes } = writer();
    const exercise = await repository.updatePersonalExercise("exercise", { ...input, videoUrl: "https://example.com/legacy" });
    expect(writes[0]).toMatchObject({ video_url: "https://example.com/legacy" });
    expect(writes[0]).not.toHaveProperty("video_links");
    expect(exercise.videoLinks).toBeUndefined();
  });

  it("rejects invalid links before sending any mutation", async () => {
    const { repository, writes } = writer();
    await expect(repository.createPersonalExercise({ ...input, videoLinks: [{ url: "javascript:alert(1)" }] })).rejects.toThrow(/http/);
    expect(writes).toEqual([]);
  });

  it("maps custom, cleared and legacy search rows distinctly", async () => {
    const rows = [links, [], null].map((video_links, index) => ({ id: `exercise-${index}`, scope: "global", name: `Exercise ${index}`, category: "Strength", cue: "", default_entry_mode: "sets", default_tracking_fields: ["reps"], video_url: "https://legacy.example.com/", video_links }));
    const repository = new LiftLogRepository({ rpc: vi.fn().mockResolvedValue({ data: rows, error: null }) } as never, "athlete", "Athlete");
    const page = await repository.searchExercises();
    expect(page.items[0].videoLinks).toEqual(links);
    expect(page.items[1].videoLinks).toEqual([]);
    expect(page.items[2].videoLinks).toBeUndefined();
    expect(page.items[2].videoUrl).toBe("https://legacy.example.com/");
  });

  it("keeps ordered links returned when appending a workout exercise", async () => {
    const repository = new LiftLogRepository({ rpc: vi.fn().mockResolvedValue({ data: { id: "item", name: "Exercise", cue: "", entryMode: "sets", trackingFields: ["reps"], videoUrl: links[0].url, videoLinks: links, prescribedEntries: [] }, error: null }) } as never, "athlete", "Athlete");
    const item = await repository.addWorkoutItem({ id: "section", title: "Exercises", items: [] }, { id: "exercise" } as Exercise);
    expect(item.videoLinks).toEqual(links);
  });
});
