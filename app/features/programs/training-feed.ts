import type { Program, ProgramRunSummary } from "../../../lib/domain";

export type TrainingFeedItem =
  | { kind: "program"; id: string; title: string; program: Program; date?: string }
  | { kind: "run"; id: string; title: string; run: ProgramRunSummary; date?: string };

export function trainingFeed(programs: Program[], runs: ProgramRunSummary[], viewerId: string, source: "all" | "own" | "coach") {
  const ownRunProgramIds = new Set(runs.filter((run) => run.athleteId === viewerId && run.createdById === viewerId).map((run) => run.programId));
  const items: TrainingFeedItem[] = source !== "coach"
    ? programs.filter((program) => program.athleteId === viewerId && program.sourceType === "self"
      && !program.editableRunId && !program.programRunId && !program.hasOwnRuns && !ownRunProgramIds.has(program.id))
      .map((program) => ({ kind: "program", id: `program:${program.id}`, title: program.title, program }))
    : [];
  for (const run of runs) {
    if (run.athleteId !== viewerId || (source !== "all" && (run.createdById === viewerId) !== (source === "own"))) continue;
    items.push({ kind: "run", id: `run:${run.id}`, title: run.title, run, date: run.nextWorkout?.plannedDate });
  }
  return [...new Map(items.map((item) => [item.id, item])).values()].sort((left, right) => (left.date ?? "9999").localeCompare(right.date ?? "9999") || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

export function isTrainingHistory(item: TrainingFeedItem) {
  return item.kind === "run" && (item.run.status === "completed" || item.run.status === "ended");
}

export function trainingDateSection(item: TrainingFeedItem, today: string) {
  return !item.date ? "No date" : item.date <= today ? "Today and overdue" : "Upcoming";
}
