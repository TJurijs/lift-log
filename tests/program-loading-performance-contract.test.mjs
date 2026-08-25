import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("workspace startup uses program summaries and opens full trees on demand", async () => {
  const [app, domain, repository] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  const catalogLoader = sourceBetween(
    repository,
    "private async loadProgramCatalog",
    "async loadEditableProgram",
  );

  assert.match(domain, /weekCount\?: number[\s\S]*workoutCount\?: number[\s\S]*detailsLoaded\?: boolean/);
  assert.match(catalogLoader, /collectAllPages<ProgramRow>/);
  assert.match(catalogLoader, /collectAllBatches<VersionRow[\s\S]*\.in\("program_id", \[\.\.\.ids\]\)/);
  assert.match(catalogLoader, /collectAllBatches<[\s\S]*WeekRow[\s\S]*\.in\("program_version_id", \[\.\.\.ids\]\)/);
  assert.match(catalogLoader, /collectAllBatches<[\s\S]*WorkoutRow[\s\S]*\.in\("program_week_id", \[\.\.\.ids\]\)/);
  assert.match(catalogLoader, /title, position, estimated_minutes/);
  assert.match(
    catalogLoader,
    /durationMinutes: workout\.estimated_minutes \?\? 45/,
  );
  assert.doesNotMatch(catalogLoader, /loadProgramPair\(/);
  assert.match(catalogLoader, /detailsLoaded: false/);
  assert.match(repository, /async loadProgramDetail\([\s\S]*return pair\.activeProgram \?\? pair\.draftProgram/);
  assert.match(app, /async function openProgram[\s\S]*repository\.loadProgramDetail/);
});
