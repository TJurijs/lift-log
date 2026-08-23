import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/202608220014_workspace_query_indexes.sql",
  import.meta.url,
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("scheduled workout lists defer exercise prescriptions until opening or starting", async () => {
  const [app, repository, migration] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);
  const summaries = sourceBetween(
    repository,
    "private async loadScheduledWorkoutSummaries",
    "async updateOwnProfile",
  );
  const detail = sourceBetween(
    repository,
    "async loadScheduledWorkoutDetail",
    "private async loadScheduledWorkoutSummaries",
  );

  assert.doesNotMatch(summaries, /\.from\("workout_sections"\)/);
  assert.doesNotMatch(summaries, /\.from\("prescribed_entries"\)/);
  assert.match(summaries, /detailsLoaded: false/);
  assert.match(detail, /\.from\("workout_sections"\)[\s\S]*\.from\("workout_items"\)[\s\S]*\.from\("prescribed_entries"\)/);
  assert.match(detail, /detailsLoaded: true/);
  assert.match(app, /async function ensureScheduledWorkoutDetails[\s\S]*loadScheduledWorkoutDetail/);
  assert.match(app, /async function openWorkoutPreview[\s\S]*ensureScheduledWorkoutDetails/);
  assert.match(app, /async function startWorkout[\s\S]*ensureScheduledWorkoutDetails/);
  for (const index of [
    "idx_programs_athlete_current_created",
    "idx_workouts_week_position",
    "idx_workout_sections_workout_position",
    "idx_prescribed_entries_item_position",
    "idx_scheduled_workouts_athlete_sequence",
  ]) {
    assert.match(migration, new RegExp(index));
  }
});
