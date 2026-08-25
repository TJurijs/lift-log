import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);

test("restored workouts resume from the server-confirmed draft revision", async () => {
  const [repository, app] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(appUrl, "utf8"),
  ]);

  const activeSessionLoader = repository.slice(
    repository.indexOf("private async loadActiveSession("),
    repository.indexOf("private async loadCoachConnections("),
  );
  assert.match(activeSessionLoader, /select\([\s\S]*draft_revision/);
  assert.match(activeSessionLoader, /draftRevision: numberValue\(session\.draft_revision\)/);
  assert.match(repository, /class SessionRevisionConflictError/);
  assert.match(repository, /Your entries are safe here/);
  assert.doesNotMatch(app, /recoverSessionDraftConflict/);
});
