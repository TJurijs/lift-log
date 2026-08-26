# Development rollout: program editor and mobile actions

Date: 2026-08-26 UTC

- Application commit: `e438bf3`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260826T001343Z`
- Retained rollback release: `/srv/liftlog/nonprod/releases/20260825T211411Z`
- Target: `https://dev.liftlog.cc`
- Hosted Supabase project: `ofyeejyfroblunbspgve`
- Database migrations: none
- Production changes: none

## Changes

- Replaced Finalize wording with consistent Save actions.
- Saved top-level workout and program names and descriptions together without stale-description overwrites.
- Removed redundant program-type summary cards and moved the type icon beside the editable title.
- Reworked mobile program-editor actions into stable back/status, secondary-action, and full-width primary rows.

## Pre-deployment gates

- Full legacy suite: 124 passed, 1 skipped, 0 failed.
- Behavior suite: 263 passed, 0 failed.
- `npm run build:nonprod`: passed.
- `git diff --check`: passed.
- Bundle target check: dev Supabase reference present; production reference absent.
- iPhone 15 and Samsung Galaxy A54 preview layouts were inspected locally without horizontal action overflow.

## Deployment and smoke evidence

- Uploaded only `dist/` into the immutable release directory.
- Switched `/srv/liftlog/nonprod/current` atomically to the new release.
- Root page: HTTP 200 with `Cache-Control: no-cache`.
- Client route `/programs`: HTTP 200.
- JavaScript asset: HTTP 200 with `public, max-age=31536000, immutable`.
- Live and local `index.html` SHA-256 matched: `E31AE857E6FF6B395C4A13944D35629A8A1BF5F64873E273878B6866C7457730`.
- Browser smoke rendered the deployed Lift Log sign-in surface. No test credential was entered or retrieved during the smoke.

Rollback was not required. If a regression is found, atomically point `/srv/liftlog/nonprod/current` back to `/srv/liftlog/nonprod/releases/20260825T211411Z`.
