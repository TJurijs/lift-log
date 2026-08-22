import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const seedUrl = new URL("../scripts/seed-test-population.mjs", import.meta.url);

test("coach workspace fixtures use real program occurrences and representative RPE", async () => {
  const seed = await readFile(seedUrl, "utf8");

  assert.match(
    seed,
    /async function completeFixtureOccurrence[\s\S]*start_or_resume_workout[\s\S]*complete_workout_session/,
  );
  assert.match(
    seed,
    /sharedCoachProgramKey = "guntis-ulmanis:raimonds-vejonis"[\s\S]*target_athlete_id: identities\.get\("guntis-ulmanis"\)\.user\.id[\s\S]*clients\.get\("raimonds-vejonis"\)/,
    "the shared athlete needs one independently authored program per coach",
  );
  assert.match(
    seed,
    /clients\.get\("alberts-kviesis"\),[\s\S]{0,180}\n\s*1,\n\s*3,/,
  );
  assert.match(
    seed,
    /clients\.get\("guntis-ulmanis"\),[\s\S]{0,180}\n\s*1,\n\s*9,/,
  );
  assert.match(
    seed,
    /sharedAthleteClient,\n\s*sharedCoachVersionId,\n\s*1,\n\s*7,/,
  );
  assert.match(
    seed,
    /sharedCoachVersionId,[\s\S]*\n\s*2,[\s\S]*\n\s*null,/,
    "a completed linked session must exercise the missing-RPE state",
  );
  assert.match(seed, /update\(\{ status: "skipped" \}\)/);
  assert.match(
    seed,
    /linkedCoachSessions[\s\S]*program_version_id[\s\S]*workout_id[\s\S]*scheduled_workout_id/,
  );
  assert.match(
    seed,
    /linkedRpes\.has\(3\)[\s\S]*linkedRpes\.has\(7\)[\s\S]*linkedRpes\.has\(9\)/,
  );
  assert.match(
    seed,
    /occurrence\.status === "in_progress"[\s\S]*occurrence\.status === "skipped"[\s\S]*occurrence\.planned_date < asOf/,
  );
});
