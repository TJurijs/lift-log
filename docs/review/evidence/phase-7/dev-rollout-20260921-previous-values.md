# Development rollout: workout defaults and previous results

Date: 2026-09-21 Europe/Riga (2026-09-20 UTC)

- Application commit: `0ae75976df55e67bb6a18c327800df290e4435f8`.
- Target: https://dev.liftlog.cc.
- Active release: `/srv/liftlog/nonprod/releases/20260920T214812Z`.
- Retained frontend rollback: `/srv/liftlog/nonprod/releases/20260910T190315Z`.
- Database: development project `ofyeejyfroblunbspgve`; 91 applied migrations, none pending.
- Production changes: none.

New sessions prefill exact prescribed reps, load, duration and distance. Ranges,
actual RPE and heart rate remain blank. Resumed drafts preserve edits, deliberate
clearing, zero values and removed entries. Finishing assumes retained entries were
completed; users can remove entries they did not perform or explicitly skip an
interval exercise.

Previous results appear as muted `Last:` hints inside measurement cells. These
references never become current logged values merely by focusing or completing a
workout. Matching is restricted to the current athlete and compatible workout/item
lineage, including copies. Historical lineage backfill is conservative; older
modified copies can legitimately have no matching previous result.

Program lifecycle recommendations remain review documents. This release does not
implement program deletion changes or the subsequent proposal to remove the
user-facing template concept. The abandoned structured complex builder is excluded.

## Validation and activation

[GitHub Actions run 35539740090](https://github.com/TJurijs/lift-log/actions/runs/35539740090)
passed both required jobs for the exact application commit before hosted migration
or site activation:

- Lint, TypeScript, production build, 720 behavior tests and 254 legacy checks
  (9 environment-specific skips).
- All bundle budgets: total JavaScript 820,165 raw / 228,804 gzip bytes;
  CSS 121,138 raw / 21,736 gzip bytes.
- Isolated Docker/Supabase startup, database integration and authoring contracts,
  recording/video, target-prefill and previous-value SQL checks, portable replay,
  recovery and scale checks.
- Desktop Chromium and mobile WebKit journeys: 30 passed, 10 intentional skips.
- Built-app offline checks: 3 passed; runtime performance gate passed.

Local guarded Docker startup and the existing local database also passed the
target-prefill, previous-value and video-cloning SQL smoke checks, with test
transactions rolled back. The local database was not reset. An initial local
behavior run hit an existing video-test timeout during concurrent Docker startup;
the unchanged focused test and all 720 behavior tests subsequently passed.

Both forward migrations applied successfully, followed by a read-only plan showing
91 applied entries and no pending migrations:

- `202609140001_prefill_workout_targets.sql`
- `202609140002_previous_workout_values.sql`

A fresh nonprod build contained the exact application SHA and development binding,
with no production binding or credential-shaped secrets. All 20 uploaded files
matched their local SHA-256 checksums. The current symlink switched atomically at
21:59:02 UTC after checking its previous target.

Live root, SPA fallback and service worker returned HTTP 200. Release metadata,
non-cached HTML/service worker, immutable assets, development framing headers and
entry-asset hashes matched expectations. Signed-in browser checks loaded the new
release, navigation and existing program detail. Desktop and mobile document
widths showed no horizontal overflow; the existing Side plank configuration still
showed four timed sets of 30 seconds. No browser errors or warnings were captured.

The guarded hosted-development API integration suite passed with zero failures or
skips. Its exact generated namespace and generated Auth accounts were cleaned up
successfully. Existing user workout data was not changed by these checks.

## Recovery evidence

Before hosted changes, a fresh private custom-format archive of Auth, public,
private and migration schemas/data was saved outside Git. Size: 1,093,278 bytes;
SHA-256 `760760e15edc306f445886601cf5b47342705fa96623c828aa4c159974f022b3`.
It restored successfully into a disposable local database with 14 accounts and
89 pre-release migration entries. Only provider-owned future DEFAULT ACL templates
were omitted from the rehearsal; the original archive retains them. The temporary
restore database was then dropped.

The previous static release remains available for frontend rollback. No destructive
database rollback or account reset was performed. Private backups, reports and
logs remain under ignored `artifacts/dev-release-20260921-previous/`.
