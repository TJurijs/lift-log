import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("builds a static Hetzner-ready application shell", async () => {
  const html = await readFile(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  const assets = await readdir(new URL("../dist/assets/", import.meta.url));
  const javascript = (
    await Promise.all(
      assets
        .filter((asset) => asset.endsWith(".js"))
        .map((asset) =>
          readFile(new URL(`../dist/assets/${asset}`, import.meta.url), "utf8"),
        ),
    )
  ).join("\n");

  assert.match(html, /<title>Lift Log<\/title>/i);
  assert.match(html, /name="viewport"[^>]+viewport-fit=cover/i);
  assert.match(html, /https:\/\/app\.liftlog\.cc\/og\.png/i);
  assert.match(html, /<div id="root"><\/div>/i);
  assert.ok(
    assets.some((asset) => asset.endsWith(".js")),
    "expected a hashed JavaScript bundle",
  );
  assert.ok(
    assets.some((asset) => asset.endsWith(".css")),
    "expected a hashed stylesheet",
  );
  assert.doesNotMatch(
    javascript,
    /presidents\.liftlog\.test|janis-cakste|Enter once, then choose an account/i,
  );
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
  assert.match(
    packageJson,
    /"dev:hosted": "node scripts\/validate-build-env\.mjs nonprod && vite --mode nonprod"/,
  );
  assert.match(packageJson, /"dev:local":\s*"[^"]*vite --mode localdev[^"]*"/);
  assert.doesNotMatch(
    packageJson,
    /vinext|wrangler|@cloudflare\/vite-plugin|@openai\/sites-vite-plugin/,
  );
});

test("keeps user data behind Supabase and wires every MVP mutation", async () => {
  const [repository, app] = await Promise.all([
    readFile(new URL("../lib/repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/LiftLogApp.tsx", import.meta.url), "utf8"),
  ]);

  for (const method of [
    "loadBootstrap",
    "listProgramSummaries",
    "getProgramVersionDetail",
    "listSchedulableWorkouts",
    "listCalendarOccurrences",
    "listCalendarSessionSummaries",
    "listCompletedSessionSummaries",
    "searchExercises",
    "listCoachAthletes",
    "loadCoachingWorkspace",
    "loadCoachedAthleteDetail",
    "createPersonalExercise",
    "addWorkout",
    "addWorkoutItem",
    "removeWorkoutItem",
    "startOrResumeSession",
    "saveSessionDraft",
    "completeSession",
    "loadCompletedSessionDetail",
    "createCoachInvite",
    "resolveCoachInviteTarget",
    "cancelCoachInvite",
    "respondToCoachInvite",
    "acceptCoachInvite",
    "endCoachRelationship",
    "updateOwnProfile",
    "createBlankProgram",
    "createProgramFromTemplate",
    "scheduleWorkout",
    "deactivateProgram",
    "updateWorkout",
    "deleteOwnProgram",
    "copyProgramToOwn",
    "deleteWorkout",
    "reorderWorkouts",
    "reorderWorkoutItems",
    "updateWorkoutItemPrescription",
  ]) {
    assert.match(
      repository,
      new RegExp(`\\b${method}\\b`),
      `${method} must be implemented`,
    );
  }

  assert.doesNotMatch(
    repository,
    /createScheduledOccurrence|createCoachScheduledOccurrence|forkProgramAssignment|assignQuickWorkoutToAthletes/,
    "the repository must not expose pre-run assignment or occurrence writers",
  );

  assert.match(app, /changes save automatically/i);
  // Autosave wiring, reload recovery, conflict rebasing, and completion are
  // exercised by the rendered active-workout behavior suite.
  assert.match(app, /repository\.loadProgramForAthlete/);
  assert.match(
    repository,
    /async deleteOwnProgram[\s\S]*\.rpc\("delete_own_program",[\s\S]*target_program_id: programId/i,
  );
  assert.doesNotMatch(
    app,
    /Thursday · 20 August|athleteSummaries|completedSessions,\s*globalExercises/,
  );
});

test("database migrations enforce RLS and transactional domain boundaries", async () => {
  const [
    initial,
    operational,
    extensibility,
    lifecycle,
    multiplePrograms,
    catalogBuilder,
    prescriptions,
    libraryInstances,
    compactItems,
    repeatingCycles,
    restoredRepeatingCycles,
    safeItemAndCycles,
    moveItems,
    deleteOwnProgram,
    inAppCoachRequests,
  ] = await Promise.all([
    readFile(
      new URL(
        "../supabase/migrations/202608200001_initial_schema.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210001_operational_mvp.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210003_private_profiles_program_library_and_athlete_scheduling.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210004_program_deactivation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210005_multiple_available_programs.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210006_program_catalog_and_builder_operations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210007_atomic_prescription_editing.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210008_library_instances_are_immutable.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210009_compact_exercises_after_deletion.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210010_repeating_cycles_and_section_editing.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210011_restore_partial_repeating_cycles.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210012_safe_item_deletion_and_complete_repeating_cycles.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210013_move_exercises_between_sections.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210014_delete_own_program.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/202608210015_in_app_coach_requests.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const tables = [...initial.matchAll(/create table public\.(\w+)/gi)].map(
    (match) => match[1],
  );

  assert.ok(tables.length >= 15, "expected the complete MVP data model");
  for (const table of tables) {
    assert.match(
      initial,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
      `${table} must enable RLS`,
    );
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
    assert.match(
      operational,
      new RegExp(`create or replace function public\\.${operation}`, "i"),
      `${operation} must be transactional`,
    );
  }

  assert.match(
    operational,
    /revoke usage on schema private from authenticated/i,
  );
  assert.match(
    operational,
    /coach_feedback_delete_author[\s\S]*public\.is_active_coach/i,
  );
  assert.match(
    operational,
    /insert into public\.exercises[\s\S]*Back squat[\s\S]*Easy run/i,
  );
  assert.doesNotMatch(
    initial,
    /create policy\s+\w+\s+on public\.coach_relationships\s+for insert/i,
  );

  assert.match(
    extensibility,
    /profiles_liftlog_id_check[\s\S]*\^LL-\[A-Z0-9\]\{16\}\$/i,
  );
  assert.match(
    extensibility,
    /create or replace function public\.update_own_profile/i,
  );
  assert.match(extensibility, /create table public\.program_templates/i);
  assert.match(
    extensibility,
    /create or replace function public\.resolve_coach_invite_target/i,
  );
  assert.match(extensibility, /invited_profile_id uuid/i);
  assert.match(
    extensibility,
    /case when target_user_id is null then normalized_email else null end/i,
  );
  assert.match(
    inAppCoachRequests,
    /coach_invites_pending_profile_check[\s\S]*invited_profile_id is not null/i,
  );
  assert.match(
    inAppCoachRequests,
    /create or replace function public\.list_pending_coach_invites\(\)/i,
  );
  assert.match(
    inAppCoachRequests,
    /create or replace function public\.respond_to_coach_invite/i,
  );
  assert.match(
    inAppCoachRequests,
    /invite\.invited_profile_id = current_user_id[\s\S]*for update/i,
  );
  assert.doesNotMatch(inAppCoachRequests, /jsonb_build_object\([^;]*'token'/i);
  assert.match(
    extensibility,
    /drop policy if exists scheduled_workouts_create_authorized/i,
  );
  assert.match(
    extensibility,
    /revoke insert, update, delete on public\.scheduled_workouts from authenticated/i,
  );
  assert.match(
    extensibility,
    /revoke execute on function public\.ensure_starter_program\(uuid\) from authenticated/i,
  );

  assert.match(
    extensibility,
    /drop function public\.reset_test_population\(text\)/i,
  );
  const resetBody =
    extensibility.match(
      /create function public\.reset_test_population\(expected_namespace text,\s*expected_persona_keys text\[\]\)[\s\S]*?\$\$;/i,
    )?.[0] ?? "";
  assert.ok(
    resetBody,
    "the fixture reset must use the namespace plus exact persona-key signature",
  );
  assert.match(
    resetBody,
    /cardinality\(expected_persona_keys\)[\s\S]*count\(distinct key_value\)/i,
  );
  assert.match(
    resetBody,
    /actual_keys is distinct from expected_keys[\s\S]*reset aborted/i,
  );
  assert.ok(
    resetBody.search(/actual_keys is distinct from expected_keys/i) <
      resetBody.search(/set_config\('liftlog\.test_reset',\s*'on'/i),
    "the exact fixture set must be checked before reset deletes are enabled",
  );
  assert.match(
    extensibility,
    /revoke all on function public\.reset_test_population\(text,\s*text\[\]\) from public,\s*anon,\s*authenticated/i,
  );
  assert.match(
    extensibility,
    /grant execute on function public\.reset_test_population\(text,\s*text\[\]\) to service_role/i,
  );

  assert.match(
    extensibility,
    /create unique index idx_scheduled_workouts_version_workout_sequence\s+on public\.scheduled_workouts \(program_version_id, workout_id, sequence_number\)\s+where sequence_number is not null/i,
  );
  const prepareBody =
    extensibility.match(
      /create or replace function public\.prepare_program_schedule[\s\S]*?\$\$;/i,
    )?.[0] ?? "";
  assert.match(prepareBody, /Only the athlete can prepare calendar workouts/i);
  assert.match(
    prepareBody,
    /insert into public\.scheduled_workouts[\s\S]*on conflict do nothing/i,
  );
  assert.match(
    prepareBody,
    /get diagnostics affected_count = row_count[\s\S]*inserted_count := inserted_count \+ affected_count/i,
  );
  const publishBody =
    extensibility.match(
      /create or replace function public\.publish_program_version[\s\S]*?\$\$;/i,
    )?.[0] ?? "";
  assert.doesNotMatch(
    publishBody,
    /(?:insert into|delete from|update) public\.scheduled_workouts/i,
  );

  const deactivateBody =
    lifecycle.match(
      /create or replace function public\.deactivate_current_program[\s\S]*?\$\$;/i,
    )?.[0] ?? "";
  assert.ok(
    deactivateBody,
    "program deactivation must be implemented transactionally",
  );
  assert.match(
    deactivateBody,
    /Only the athlete can deactivate their current program/i,
  );
  assert.match(
    deactivateBody,
    /Finish or abandon the active workout before changing programs/i,
  );
  assert.match(
    deactivateBody,
    /delete from public\.scheduled_workouts[\s\S]*status = 'planned'/i,
  );
  assert.match(deactivateBody, /not exists[\s\S]*public\.workout_sessions/i);
  assert.match(
    deactivateBody,
    /update public\.programs[\s\S]*is_current = false[\s\S]*archived_at = now\(\)/i,
  );
  assert.match(
    lifecycle,
    /revoke all on function public\.deactivate_current_program\(uuid\) from public/i,
  );
  assert.match(
    lifecycle,
    /grant execute on function public\.deactivate_current_program\(uuid\) to authenticated/i,
  );

  assert.match(
    multiplePrograms,
    /drop index if exists public\.idx_programs_one_current/i,
  );
  assert.doesNotMatch(
    multiplePrograms,
    /already has a current program|already have a current program/i,
  );
  assert.match(
    multiplePrograms,
    /create or replace function public\.create_blank_program/i,
  );
  assert.match(
    multiplePrograms,
    /create or replace function public\.create_program_from_template/i,
  );

  assert.match(catalogBuilder, /create table public\.program_availability/i);
  assert.match(catalogBuilder, /foreign key \(program_id, athlete_id\)/i);
  assert.match(
    catalogBuilder,
    /create or replace function public\.set_program_availability/i,
  );
  assert.match(
    catalogBuilder,
    /create or replace function public\.copy_program_to_own/i,
  );
  assert.match(
    catalogBuilder,
    /program\.created_by_id = \(select auth\.uid\(\)\)[\s\S]*program\.source_type = 'coach'[\s\S]*is_active_coach/i,
  );
  for (const operation of [
    "add_program_week",
    "delete_program_week",
    "delete_program_workout",
    "add_workout_section",
    "delete_workout_section",
    "reorder_week_workouts",
    "reorder_section_items",
  ]) {
    assert.match(
      catalogBuilder,
      new RegExp(`create or replace function public\\.${operation}`, "i"),
    );
  }
  assert.match(
    moveItems,
    /create or replace function public\.move_workout_item/i,
  );
  assert.match(moveItems, /public\.can_edit_version/i);
  assert.match(
    moveItems,
    /grant execute on function public\.move_workout_item[\s\S]*to authenticated/i,
  );
  assert.match(
    prescriptions,
    /create or replace function public\.save_workout_item_prescription/i,
  );
  assert.match(prescriptions, /public\.can_edit_version/i);
  assert.match(
    prescriptions,
    /delete from public\.prescribed_entries[\s\S]*insert into public\.prescribed_entries/i,
  );
  assert.match(
    prescriptions,
    /grant execute on function public\.save_workout_item_prescription[\s\S]*to authenticated/i,
  );
  assert.match(
    libraryInstances,
    /idx_programs_one_library_template_per_athlete/i,
  );
  assert.doesNotMatch(libraryInstances, /create_program_draft/i);
  assert.match(libraryInstances, /source_type = 'library'/i);
  assert.match(
    compactItems,
    /create or replace function public\.delete_workout_item/i,
  );
  assert.match(
    compactItems,
    /position = position \+ 1000[\s\S]*position = position - 1001/i,
  );
  assert.match(repeatingCycles, /target_planning_mode = 'repeating_week'/i);
  assert.match(repeatingCycles, /status in \('planned', 'in_progress'\)/i);
  assert.match(repeatingCycles, /max\(scheduled\.sequence_number\)/i);
  assert.match(
    repeatingCycles,
    /create or replace function public\.update_workout_section/i,
  );
  assert.match(
    repeatingCycles,
    /create or replace function public\.reorder_workout_sections/i,
  );
  assert.match(
    restoredRepeatingCycles,
    /cycle_start := \(\(maximum_sequence - 1\) \/ workout_count\) \* workout_count/i,
  );
  assert.match(
    restoredRepeatingCycles,
    /scheduled\.sequence_number > cycle_start[\s\S]*scheduled\.status in \('planned', 'in_progress'\)/i,
  );
  assert.match(
    safeItemAndCycles,
    /delete from public\.prescribed_entries where workout_item_id = target_item_id[\s\S]*delete from public\.workout_items/i,
  );
  assert.match(
    safeItemAndCycles,
    /present_count = workout_count[\s\S]*status in \('planned', 'in_progress'\)/i,
  );
  assert.match(safeItemAndCycles, /public\.program_availability/i);
  const deleteOwnProgramBody =
    deleteOwnProgram.match(
      /create or replace function public\.delete_own_program[\s\S]*?\$\$;/i,
    )?.[0] ?? "";
  assert.ok(
    deleteOwnProgramBody,
    "Own-program deletion must be implemented transactionally",
  );
  assert.match(
    deleteOwnProgramBody,
    /program\.athlete_id = current_user_id[\s\S]*program\.created_by_id = current_user_id[\s\S]*program\.source_type = 'self'/i,
  );
  assert.match(
    deleteOwnProgramBody,
    /scheduled\.status = 'in_progress'[\s\S]*session\.status = 'in_progress'/i,
  );
  assert.match(
    deleteOwnProgramBody,
    /update public\.programs[\s\S]*archived_at = now\(\)[\s\S]*is_current = false/i,
  );
  assert.match(
    deleteOwnProgramBody,
    /delete from public\.program_availability/i,
  );
  assert.match(
    deleteOwnProgramBody,
    /delete from public\.scheduled_workouts[\s\S]*scheduled\.status = 'planned'[\s\S]*not exists[\s\S]*public\.workout_sessions/i,
  );
  assert.doesNotMatch(deleteOwnProgramBody, /delete from public\.programs/i);
  assert.match(
    deleteOwnProgram,
    /drop policy if exists programs_delete_owner on public\.programs/i,
  );
  assert.match(
    deleteOwnProgram,
    /revoke delete on public\.programs from authenticated/i,
  );
  assert.match(
    deleteOwnProgram,
    /revoke all on function public\.delete_own_program\(uuid\) from public[\s\S]*grant execute on function public\.delete_own_program\(uuid\) to authenticated/i,
  );
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
