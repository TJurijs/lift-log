import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalogPath = new URL(
  "../supabase/migrations/202608300006_catalyst_exercise_catalog.sql",
  import.meta.url,
);
const schemaPath = new URL(
  "../supabase/migrations/202608300005_exercise_source_media_metadata.sql",
  import.meta.url,
);
const workoutVideoPath = new URL(
  "../supabase/migrations/202608300007_exercise_videos_in_workouts.sql",
  import.meta.url,
);
const loggingDefaultsPath = new URL(
  "../supabase/migrations/202608300012_format_driven_exercise_tracking.sql",
  import.meta.url,
);

test("the Catalyst snapshot contains every source exercise and demo", async () => {
  const catalog = await readFile(catalogPath, "utf8");

  assert.equal(
    [...catalog.matchAll(/https:\/\/www\.catalystathletics\.com\/exercise\//g)]
      .length,
    624,
  );
  assert.equal(
    [...catalog.matchAll(/https:\/\/www\.youtube\.com\/watch\?v=/g)].length,
    624,
  );
  assert.match(catalog, /source_provider = 'catalyst-athletics'/);
  for (const category of [
    "Weightlifting",
    "Strength",
    "Bodybuilding",
    "Bodyweight",
    "Functional fitness",
    "Gymnastics",
    "Core",
    "Mobility",
  ]) {
    assert.match(catalog, new RegExp(`'${category}'`));
  }
});

test("source and video metadata reach planned and completed workouts", async () => {
  const schema = await readFile(schemaPath, "utf8");
  const workoutVideo = await readFile(workoutVideoPath, "utf8");

  assert.match(schema, /add column source_url text/);
  assert.match(schema, /add column video_url text/);
  assert.match(schema, /add column source_metadata jsonb/);
  assert.match(workoutVideo, /add column snapshot_video_url text/);
  assert.match(workoutVideo, /'videoUrl', exercise\.video_url/);
  assert.match(workoutVideo, /'videoUrl', item\.snapshot_video_url/);
});

test("Catalyst tracking defaults follow movement semantics rather than category", async () => {
  const loggingDefaults = await readFile(loggingDefaultsPath, "utf8");

  assert.match(loggingDefaults, /source_metadata ->> 'sectionId'/);
  assert.match(loggingDefaults, /array\['distance', 'duration', 'rpe'\]/);
  assert.match(loggingDefaults, /array\['reps', 'rpe'\]/);
  assert.match(loggingDefaults, /array\['reps', 'load', 'rpe'\]/);
  assert.doesNotMatch(loggingDefaults, /exercise\.category/);
  assert.match(loggingDefaults, /version\.status = 'draft'/);
  assert.match(loggingDefaults, /scheduled\.status = 'planned'/);
});
