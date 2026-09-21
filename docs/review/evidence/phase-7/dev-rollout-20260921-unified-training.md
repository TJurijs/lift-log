# Development rollout: unified Training and simpler authoring

Date: 2026-09-21

- Application commit: `cc6dd0b70b8baebc511e244e94e4bc8062c3e61c`.
- Target: https://dev.liftlog.cc.
- Active release: `/srv/liftlog/nonprod/releases/20260921T140844Z`.
- Activated at: `2026-09-21T14:11:48.917Z`.
- Retained frontend rollback: `/srv/liftlog/nonprod/releases/20260920T214812Z`.
- Database: development project `ofyeejyfroblunbspgve`; 96 applied migrations, none pending.
- Production changes: none.

## Released behavior

Training combines workouts and programs in Active and History, with unfinished
training ordered by date and undated training retained. Start, Resume, Repeat,
Assign, optional dates, and Delete/End operate on those training objects. The
separate Next destination and user-facing template/publication workflow are
removed. Completed results, previous-value hints, and active-session recovery are
preserved. Upcoming occurrence edits and athlete copies remain independent.

Workout cards open by clicking their content. Start/Resume and the actions menu
remain separate; mobile menus expand inside the card so the last action can be
scrolled into view. Programs show a highlighted workout list on both screen sizes.
The editor presents Save, with operational actions in the detail view. Routine
guidance is shortened; workout notes and meaningful consequences remain.

New workouts have no estimated duration unless entered. New weighted strength
prescriptions use reps and weight, with RPE optional and off; movement-specific
defaults and existing prescriptions remain intact. Exercise search can also add a
typed custom exercise to this workout only. Its snapshot survives editing,
repeating, assignment, and logging without creating a library entry.

See the [unified Training review](../../2026-09-21-unified-training.md) and
[simple authoring review](../../2026-09-21-simple-authoring.md) for detailed behavior.

## Release validation

[GitHub Actions run 35608901319](https://github.com/TJurijs/lift-log/actions/runs/35608901319)
passed both required jobs for the exact application commit before hosted migration
or activation:

- Lint, TypeScript, production build, all bundle budgets, 804 behavior tests across
  87 files, and 230 legacy checks with 9 environment-specific skips.
- Isolated Supabase startup; database/API, authoring, lifecycle, custom exercise,
  prefill, previous-value, video, authorization, and concurrency contracts.
- All 96 migrations replayed in an isolated database, preserving its preexisting
  account; second promotion was a no-op. Restore rehearsal and scale verification
  passed, including 50 athletes, 7,500 sessions, and 5,000 exercises.
- Desktop Chromium/mobile WebKit journeys: 34 passed, 10 intentional skips.
- Built-app offline/mobile-preview checks: 3 passed. Runtime budgets passed.

Pre-release checks also corrected stale UI test labels/resume assumptions and a
database scale preflight that expected the old summary function signature. The
updated scale test covers explicit Active/History reads and retains coverage for
older five-argument callers, without relaxing its limits. The final CI run had no
failures or flaky tests.

A fresh nonprod build embedded the application SHA and exact dev project binding.
The upload check rejected production bindings and credential-shaped secrets. All
26 uploaded files matched local SHA-256 hashes; directories use 0755 and files
0644. The previous symlink target was checked before atomic activation.

Live root, SPA fallback, service worker, and entry assets returned HTTP 200.
Release metadata and entry-asset hashes matched; HTML/service worker use no-cache,
hashed assets use immutable caching, and development framing uses SAMEORIGIN.

Authenticated read-only browser checks passed at 1440px and 390px: Training,
History, Calendar, Exercises, Coaching, existing workout/program detail, and
sign-out. No page errors, rejected application writes, or horizontal overflow
were observed. Hosted dev API integration passed with no failures or skips and
cleaned up its generated accounts and fixtures.

## Database and recovery

The guarded portable promoter applied these five forward migrations and then
reported 96 applied entries with no pending migrations:

- `202609210001_optional_rpe_defaults.sql`
- `202609210002_workout_program_lifecycle.sql`
- `202609210003_unified_training.sql`
- `202609210004_optional_workout_duration.sql`
- `202609210005_workout_custom_exercises.sql`

Before promotion, a fresh private custom-format backup of Auth, public, private,
and migration schemas/data was saved outside Git. Size: 1,118,902 bytes;
SHA-256 `f98bae9a58a57c14ced1af2a33bf31293c4400ee50fc87942530859c0ddd59b9`.
Its digest was verified, and it restored into a disposable local database with 14
accounts and 91 pre-release migration entries. Only provider-owned future DEFAULT
ACL templates were excluded from the rehearsal; the original archive retains
them. The temporary database was removed afterward.

Before/after counts remained equal after migration and hosted integration cleanup:
14 accounts, 18 programs, 84 workouts, 561 workout items, 1,622 prescriptions,
13 runs, 25 run workouts, 16 sessions, 67 item logs, and 161 recorded entries.
Migration review confirmed existing prescriptions/results are not rewritten;
the intended existing-data change removes RPE from global exercise defaults.

The previous static release remains available for frontend rollback. No local
application database reset, destructive database rollback, or production change
was performed. Private backups, screenshots, reports, and logs remain under
ignored `artifacts/dev-release-20260921-unified/`.
