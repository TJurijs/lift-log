# Development rollout: completed workout log redesign

Date: 2026-08-27 UTC

- Application commit: `58e4406`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260827T191720Z`
- Retained rollback release: `/srv/liftlog/nonprod/releases/20260826T001343Z`
- Target: `https://dev.liftlog.cc`
- Hosted Supabase project: `ofyeejyfroblunbspgve`
- Database migrations: none
- Production changes: none

## Changes

- Replaced flattened completed-set summaries with the same compact metric grid used while logging a workout.
- Enlarged saved values and applied the shared green, amber, and red RPE palette to set and session effort.
- Added a release contract covering completed-log structure and RPE presentation.
- Removed a redundant program-editor synchronization effect so the lint gate remains clean.

## Pre-deployment gates

- `npm run lint`: passed.
- Full legacy suite: 125 passed, 1 skipped, 0 failed.
- Behavior suite: 263 passed, 0 failed.
- `npm run build:nonprod`: passed.
- `git diff --check`: passed.
- Bundle target check: development Supabase reference present; production reference absent.
- iPhone 15 and Samsung Galaxy A54 completed-result layouts were inspected locally.

## Deployment and smoke evidence

- Uploaded only `dist/` into the immutable release directory.
- Every uploaded file SHA-256 matched the local nonproduction build before cutover.
- Switched `/srv/liftlog/nonprod/current` atomically to the new release.
- Root page: HTTP 200 with `Cache-Control: no-cache`.
- Client route `/programs`: HTTP 200.
- JavaScript asset: HTTP 200 with `public, max-age=31536000, immutable`.
- Deployed CSS and application chunks contain the completed-log grid and value styles.
- Browser smoke rendered the Lift Log development sign-in surface with no console errors. No test credential was entered or retrieved.

Rollback was not required. If a regression is found, atomically point `/srv/liftlog/nonprod/current` back to `/srv/liftlog/nonprod/releases/20260826T001343Z`.
