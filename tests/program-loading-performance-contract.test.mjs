import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const programViewUrl = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
  import.meta.url,
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("workspace startup stays bounded and does not hydrate the program catalog", async () => {
  const [domain, repository] = await Promise.all([
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  const bootstrap = sourceBetween(
    repository,
    "private async loadBootstrapData()",
    "async loadExerciseWorkspace()",
  );

  assert.match(domain, /export interface CursorPage<[\s\S]*hasMore: boolean/);
  assert.match(
    domain,
    /weekCount\?: number[\s\S]*workoutCount\?: number[\s\S]*detailsLoaded\?: boolean/,
  );
  assert.match(bootstrap, /rpc\("get_workspace_bootstrap"\)/);
  assert.doesNotMatch(bootstrap, /listProgramSummaries|loadProgramDetail|\.from\(/);
  assert.match(
    bootstrap,
    /programCatalog: \[\][\s\S]*schedulablePrograms: \[\]/,
    "startup must not include an unbounded program tree or catalog",
  );
  assert.doesNotMatch(repository, /loadWorkspace(?:Data)?\s*\(/);
  assert.doesNotMatch(bootstrap, /collectAll(?:Pages|Batches)|collectCursorPages/);
});

test("program summaries use one keyset-bounded RPC page", async () => {
  const [repository, migration] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);
  const summaries = sourceBetween(
    repository,
    "async listProgramSummaries(",
    "async listCalendarOccurrences(",
  );

  assert.match(summaries, /rpc\("list_program_summaries"/);
  assert.match(summaries, /page_limit: limit \+ 1/);
  assert.match(summaries, /after_created_at: options\.cursor\?\.createdAt \?\? null/);
  assert.match(summaries, /after_id: options\.cursor\?\.id \?\? null/);
  assert.match(summaries, /detailsLoaded: false/);
  assert.match(summaries, /assignmentId[\s\S]*customizedProgramId/);
  assert.doesNotMatch(summaries, /\.from\(/);
  assert.match(
    migration,
    /create or replace function public\.list_program_summaries\([\s\S]*page_limit integer default 25[\s\S]*after_created_at timestamptz default null[\s\S]*after_id uuid default null/,
  );
  assert.match(migration, /least\(greatest\(coalesce\(page_limit, 25\), 1\), 50\)/);
});

test("opening a selected program fetches, caches, and lazy-loads one immutable tree", async () => {
  const [app, programView, repository] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(programViewUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  const detail = sourceBetween(
    repository,
    "async getProgramVersionDetail(",
    "async loadProgramForAthleteById(",
  );

  assert.match(detail, /Boolean\(selector\.programId\) === Boolean\(selector\.assignmentId\)/);
  assert.match(detail, /rpc\("get_program_version_detail"/);
  assert.match(detail, /target_program_id:[\s\S]*target_assignment_id:[\s\S]*target_version_id:/);
  assert.match(detail, /parseProgramDetailPayload/);
  assert.match(detail, /ttlMs: selector\.versionId \? Infinity : 30_000/);
  assert.match(detail, /value\.versionStatus !== "draft"/);
  assert.doesNotMatch(detail, /\.from\(/);
  assert.match(
    app,
    /async function openProgram[\s\S]*targetProgram\.detailsLoaded !== false[\s\S]*repository\.loadProgramDetail/,
  );
  assert.match(
    app,
    /const loadProgramView = \(\) => import\("\.\/features\/programs\/ProgramView"\)[\s\S]*const ProgramView = lazy\(loadProgramView\)/,
  );
  assert.match(app, /async function openProgram[\s\S]*void loadProgramView\(\)/);
  assert.doesNotMatch(app, /@dnd-kit/);
  assert.doesNotMatch(programView, /@dnd-kit/);
  assert.match(programView, /function moveItemIds/);
  assert.match(programView, /aria-label={`Move \$\{label\} up`}/);
  assert.match(programView, /aria-label={`Move \$\{label\} down`}/);
});
