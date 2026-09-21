# Workout and program refactor — September 21, 2026

This records the first local iteration and its validation. The later approved [unified Training approach](2026-09-21-unified-training.md) supersedes the Plan step and separate Next destination described below. Its verification is tracked separately.

## Product behavior

Training contains workouts and programs that users create, start or plan, repeat, and assign. Standalone workouts use a single date screen. Templates, saved versions, publication, availability switches, and “in use” editing locks are no longer user-facing management concepts.

An upcoming workout can be edited independently, including before it receives a date. Its athlete and currently connected assigning coach may edit it; the change leaves the source, other occurrences, and other athletes' plans intact. Starting freezes its prescribed content. Repeat opens a fresh editable copy of the selected effective plan; history can repeat a completed workout as a standalone workout. Assign copies the selected plan's effective content, including its edits. Ending a plan cancels remaining work and retains completed history.

New weighted strength exercises track reps and weight by default. RPE remains an optional field. Timed/bodyweight/distance exercises retain their appropriate base metrics, and existing prescriptions and personal preferences remain intact.

## Implementation and local verification

Two forward migrations were applied with the guarded local promotion runner, taking the existing local database from **91 to 93 migrations**, without resetting it:

- `202609210001_optional_rpe_defaults.sql`: optional RPE defaults without rewriting existing workouts or performed results.
- `202609210002_workout_program_lifecycle.sql`: private editable occurrence copies, publication on start, effective workout reads, repeat/assignment copying, completed-workout reuse, and hidden-container/history protection.

The second migration retains original run-slot identity for ordering while exposing effective workout/version pointers to readers. Existing lineage IDs survive copies so previous-result hints continue to match. Private occurrence containers are excluded from catalog cards. `has_own_runs` prevents paginated source entries from reappearing as duplicate template cards. Database authorization remains authoritative; the browser does not grant access through button visibility alone.

Verified locally:

| Check | Evidence |
| --- | --- |
| New lifecycle SQL smoke | Isolated source/athlete copies; undated edits; edited Calendar moves; original program labels; athlete/current-coach access; revoked-coach and unrelated-user denial; hidden-container spoof rejection; repeat/assignment content and idempotency; frozen completed content; retained history; ghost lineage; isolated fixture cleanup. Transaction rolled back. |
| Regression SQL suites | Optional RPE defaults, atomic authoring, prefill, previous values, and video links all passed. |
| Local API integration | Existing authenticated Supabase integration suite passed. Three expected repeat titles were updated because copies retain the selected workout/program name. |
| Desktop and mobile UI | `tests/e2e/local-training-lifecycle.spec.ts` passed on desktop Chromium and mobile WebKit against the real local app and database: create workout; Back squat reps/weight defaults with RPE unchecked; one-screen Plan; edit planned copy from 5 to 8 reps while source stays 5; repeat into editable copy; change repeat to 11 while prior plan stays 8. Viewport checks and browser error checks passed. A rerun after the single-step dialog layout fix also verifies the Plan action stays between 44 and 64 px high on both engines (2/2 passed). |
| Fixture cleanup | Browser tests ended only their newly created runs and archived only their newly created own workout records through the authenticated fixture API. No user data or hosted environment was changed. |
| Manual local preview | Created and planned `Strength session · local preview` in the local fictional Valdis Zatlers test account. Verified the mobile creation menu, reps/weight prescription, single-date dialog, scheduled-workout preview, and independent editor. The date dialog uses fixed grid rows so its actions remain normal-sized when no progress indicator is needed. The sample remains available for local review. |
| Navigation regression checks | Scheduled workouts open directly from Training and in-progress workouts resume their existing session. Back restores the same training detail. Coach views select edited effective workout IDs and cannot expose athlete recording actions. These paths are covered by behavior tests; opening the sample's schedule and returning to its exact detail were also verified manually. |
| Final frontend checks | Full ESLint, TypeScript, production build, and whitespace checks passed. All 743 behavior tests across 83 files passed. Legacy checks: 261 passed, zero failed, one optional hosted integration check skipped. All bundle budgets passed: total JavaScript 823,576 bytes / 229,661 gzip; largest async chunk 42,433 gzip. Budgets were not increased. |
| Independent SQL review | Corrected former-coach copy access, aligned start/edit locking to run → occurrence order, and locked the run before discovering editable versions during a copy. Follow-up review found no further blockers in the reviewed authorization, freeze, history, and idempotency paths. |
| Portable migration rehearsal | All 93 migrations replayed successfully in an isolated database; 11 reviewed development-only data operations were skipped, a preexisting account survived, and a second promotion was a no-op. The developer's existing application database was not reset. |
| Database lint and contract | Lint passed with the preexisting `normalize_exercise_video_links` volatility warning. Read-only contract export contains 150 effective functions and 93 applied migrations. New lifecycle smoke and browser test pass ESLint. |

Local evidence artifacts are under `artifacts/workout-program-lifecycle-contract`, `artifacts/workout-lifecycle-api-integration.log`, and `artifacts/training-lifecycle-e2e.log`. Browser screenshots are in the corresponding `test-results/local-training-lifecycle-…` project directories. These generated artifacts are ignored by Git.

Final frontend evidence is in `artifacts/training-refactor-behavior.log`, `artifacts/training-refactor-legacy.log`, `artifacts/training-refactor-lint.log`, `artifacts/training-refactor-typecheck.log`, `artifacts/training-lazy-home-build.log`, and `artifacts/training-final-bundle-gate.log`. Training now loads with the existing program feature bundle. Retired assignment/deactivation UI and unused repository methods were removed rather than carried forward into the new workflow.

## Release status

This first iteration was reviewed locally. Its subsequent unified Training and simplified authoring implementation has now been pushed and deployed to development, including all five September 21 migrations. See the [rollout evidence](evidence/phase-7/dev-rollout-20260921-unified-training.md). Production remains unchanged. The local mobile preview remains available at `http://127.0.0.1:3000/?preview=mobile#/training` using the fictional local test account.
