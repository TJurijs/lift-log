import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("builds a static Hetzner-ready application shell", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const assets = await readdir(new URL("../dist/assets/", import.meta.url));

  assert.match(html, /<title>Lift Log<\/title>/i);
  assert.match(html, /name="viewport"[^>]+viewport-fit=cover/i);
  assert.match(html, /https:\/\/app\.liftlog\.cc\/og\.png/i);
  assert.match(html, /<div id="root"><\/div>/i);
  assert.ok(assets.some((asset) => asset.endsWith(".js")), "expected a hashed JavaScript bundle");
  assert.ok(assets.some((asset) => asset.endsWith(".css")), "expected a hashed stylesheet");
  await access(new URL("../dist/og.png", import.meta.url));
});

test("uses Vite public configuration and disables the demo in production", async () => {
  const [entry, auth, packageJson, viteConfig, envExample] = await Promise.all([
    readFile(new URL("../app/AppEntry.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(entry, /const localDemoAvailable = import\.meta\.env\.DEV/);
  assert.match(auth, /VITE_SUPABASE_URL/);
  assert.match(auth, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(envExample, /^VITE_SITE_URL=/m);
  assert.doesNotMatch(envExample, /SERVICE_ROLE/i);
  assert.match(viteConfig, /@vitejs\/plugin-react/);
  assert.match(packageJson, /"build": "tsc --noEmit && vite build"/);
  assert.match(packageJson, /"dev:demo": "vite --mode demo"/);
  assert.match(packageJson, /"dev:hosted": "node scripts\/validate-build-env\.mjs nonprod && vite --mode nonprod"/);
  assert.doesNotMatch(packageJson, /"dev:local"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|@cloudflare\/vite-plugin|@openai\/sites-vite-plugin/);
});

test("keeps user data behind Supabase and wires every MVP mutation", async () => {
  const [repository, app] = await Promise.all([
    readFile(new URL("../lib/repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/LiftLogApp.tsx", import.meta.url), "utf8"),
  ]);

  for (const method of [
    "loadWorkspace",
    "createPersonalExercise",
    "addWorkout",
    "addWorkoutItem",
    "removeWorkoutItem",
    "duplicateWeek",
    "publishProgram",
    "startOrResumeSession",
    "saveSessionDraft",
    "completeSession",
    "createCoachInvite",
    "acceptCoachInvite",
    "endCoachRelationship",
  ]) {
    assert.match(repository, new RegExp(`\\b${method}\\b`), `${method} must be implemented`);
  }

  assert.match(app, /changes save automatically/i);
  assert.match(app, /repository\.saveSessionDraft/);
  assert.match(app, /repository\.loadProgramForAthlete/);
  assert.doesNotMatch(app, /Thursday · 20 August|athleteSummaries|completedSessions,\s*globalExercises/);
});

test("database migrations enforce RLS and transactional domain boundaries", async () => {
  const [initial, operational] = await Promise.all([
    readFile(new URL("../supabase/migrations/202608200001_initial_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608210001_operational_mvp.sql", import.meta.url), "utf8"),
  ]);
  const tables = [...initial.matchAll(/create table public\.(\w+)/gi)].map((match) => match[1]);

  assert.ok(tables.length >= 15, "expected the complete MVP data model");
  for (const table of tables) {
    assert.match(initial, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `${table} must enable RLS`);
  }

  for (const operation of [
    "ensure_starter_program",
    "create_program_draft",
    "duplicate_program_week",
    "publish_program_version",
    "start_or_resume_workout",
    "complete_workout_session",
    "create_coach_invite",
  ]) {
    assert.match(operational, new RegExp(`create or replace function public\\.${operation}`, "i"), `${operation} must be transactional`);
  }

  assert.match(operational, /revoke usage on schema private from authenticated/i);
  assert.match(operational, /coach_feedback_delete_author[\s\S]*public\.is_active_coach/i);
  assert.match(operational, /insert into public\.exercises[\s\S]*Back squat[\s\S]*Easy run/i);
  assert.doesNotMatch(initial, /create policy\s+\w+\s+on public\.coach_relationships\s+for insert/i);
});

test("removes the obsolete server and Cloudflare entry points", async () => {
  for (const path of [
    "../app/layout.tsx",
    "../app/page.tsx",
    "../worker/index.ts",
    "../next.config.ts",
    "../.openai/hosting.json",
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url)));
  }
});
