import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appEntryUrl = new URL("../app/AppEntry.tsx", import.meta.url);
const performanceUrl = new URL("../lib/performance.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);

test("bootstrap loads are bounded, deduplicated, and observable", async () => {
  const [appEntry, performance, repository] = await Promise.all([
    readFile(appEntryUrl, "utf8"),
    readFile(performanceUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);

  assert.match(appEntry, /const transientWorkspaceRetryDelays = \[800\]/);
  assert.match(appEntry, /function isTransientWorkspaceError[\s\S]*timeout[\s\S]*failed to fetch/);
  assert.match(appEntry, /while \(!nextWorkspace\)[\s\S]*retryDelay[\s\S]*transientWorkspaceRetryDelays/);
  assert.match(appEntry, /activeRepository\.loadBootstrap\(\)/);
  assert.match(
    appEntry,
    /recordClientPerformance\("bootstrap"[\s\S]{0,160}phase: "shell"/,
  );
  assert.match(
    appEntry,
    /const LiftLogApp = lazy\(\(\) =>[\s\S]*import\("\.\/LiftLogApp"\)\.then\(\(\{ default: component \}\)/,
  );
  assert.doesNotMatch(appEntry, /import LiftLogApp from "\.\/LiftLogApp"/);
  assert.match(repository, /getOrLoad\("bootstrap"/);
  assert.match(repository, /rpc\("get_workspace_bootstrap"\)/);
  assert.match(
    repository,
    /recordClientPerformance\("bootstrap"[\s\S]{0,160}phase: "repository"/,
  );
  assert.doesNotMatch(repository, /async loadWorkspace\(|workspaceLoadPromise/);
  assert.match(performance, /slowOperationThresholdMs = 2_500/);
  assert.match(performance, /performance\.measure/);
  assert.match(performance, /new CustomEvent\("liftlog:performance"/);
});
