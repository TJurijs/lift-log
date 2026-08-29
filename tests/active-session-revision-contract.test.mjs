import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
  import.meta.url,
);

test("restored workouts resume from the server-confirmed draft revision", async () => {
  const [repository, app, migration] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  const bootstrapLoader = repository.slice(
    repository.indexOf("private async loadBootstrapData("),
    repository.indexOf("async loadExerciseWorkspace("),
  );
  assert.match(bootstrapLoader, /rpc\("get_workspace_bootstrap"\)/);
  assert.match(bootstrapLoader, /parseActiveSessionPayload/);
  assert.doesNotMatch(bootstrapLoader, /\.from\("workout_sessions"\)/);
  assert.match(
    repository,
    /draftRevision: jsonInteger\(row, "draftRevision", "draft_revision"\) \?\? 0/,
  );
  assert.match(repository, /draftWriteToken:[\s\S]*"draft_write_token"/);
  assert.match(
    migration,
    /get_workspace_bootstrap[\s\S]*'draftRevision'[\s\S]*'draftWriteToken'/,
  );
  assert.match(repository, /class SessionRevisionConflictError/);
  assert.match(repository, /Your entries are safe here/);
  assert.doesNotMatch(app, /recoverSessionDraftConflict/);
});
