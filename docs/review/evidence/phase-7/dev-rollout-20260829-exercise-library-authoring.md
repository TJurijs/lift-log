# Development rollout: exercise library and simplified authoring

Date: 2026-08-29 UTC

- Application commit: `e40c256`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260829T234244Z`
- Retained rollback release: `/srv/liftlog/nonprod/releases/20260829T165630Z`
- Target: `https://dev.liftlog.cc`
- Hosted Supabase project: `ofyeejyfroblunbspgve`
- Database migrations: `202608290002` through `202608300013`
- Production changes: none

## Changes

- Simplified programs to an ordered workout sequence and workouts to one ordered exercise list.
- Added bounded frequent-workout scheduling, category-specific exercise icons, and in-app exercise video playback.
- Imported and classified the Catalyst exercise catalogue while retaining source and video metadata.
- Made exercise logging format-driven and refreshed the upcoming three-day program with video-backed alternatives at target RPE 8.
- Removed obsolete editor styles so the expanded interface remains inside the established CSS budget.

## Pre-deployment gates

- `npm run ci:verify`: passed.
- Lint and TypeScript checks: passed.
- Legacy suite: 153 passed, 1 expected skip, 0 failed.
- Behavior suite: 325 passed, 0 failed.
- Production build and all JavaScript/CSS bundle budgets: passed.
- `npm run build:nonprod`: passed from commit `e40c2563f946ac15c09efa0405ae5570855d8a0d`.
- The nonproduction bundle contains the development Supabase reference and no production reference.
- Linked development migration history matches local migrations through `202608300013`.

## Deployment and smoke evidence

- Uploaded only `dist/` into the new immutable release directory.
- All 15 uploaded files matched the local nonproduction build by SHA-256 before cutover.
- Switched `/srv/liftlog/nonprod/current` atomically to the new release.
- Root page and client route `/programs` returned HTTP 200.
- HTML retained `Cache-Control: no-cache`; the hashed JavaScript asset retained immutable caching.
- Deployed HTML reports the exact application SHA `e40c2563f946ac15c09efa0405ae5570855d8a0d`.
- Browser smoke rendered the Lift Log development sign-in surface in the mobile preview with no browser warnings or errors.

Rollback was not required. If a regression is found, atomically point `/srv/liftlog/nonprod/current` back to `/srv/liftlog/nonprod/releases/20260829T165630Z`. The applied database migrations are forward-compatible with that frontend release; no database rollback is required for a frontend rollback.
