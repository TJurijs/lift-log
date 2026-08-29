# Development rollout: V1 performance architecture and mobile authoring

Date: 2026-08-29 UTC

- Application commit: `82e0048`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260829T165630Z`
- Retained rollback release: `/srv/liftlog/nonprod/releases/20260827T191720Z`
- Target: `https://dev.liftlog.cc`
- Hosted Supabase project: `ofyeejyfroblunbspgve`
- Database migration: `202608290001_v1_performance_data_architecture.sql`
- Production changes: none

## Changes

- Added the V1 bounded-query data architecture, assignment model, indexes, repository boundaries, performance instrumentation, and operational evidence required for larger programs and coaching workloads.
- Split and lazy-loaded program features to reduce initial work and keep future feature development modular.
- Replaced the mobile-only exercise drop target with a tap-first, searchable section exercise picker while preserving desktop drag and drop.
- Added mobile prescription-layout improvements and behavior coverage for the new exercise-selection flow.

## Pre-deployment gates

- `npm run ci:verify`: passed.
- Lint and TypeScript checks: passed.
- Legacy suite: 145 passed, 1 expected skip, 0 failed.
- Behavior suite: 314 passed, 0 failed.
- Production build and bundle budgets: passed.
- `npm run build:nonprod`: passed from commit `82e0048c6c2bc959d0b7dbc3717c0f62d7c0a389`.
- Bundle target check: development Supabase reference present; production reference absent.
- Linked dev migration history contains matching local and remote migration `202608290001`.
- Mobile exercise picker and prescription flows were inspected in the local phone preview.

## Deployment and smoke evidence

- Uploaded only `dist/` into the immutable release directory.
- All 14 uploaded files matched the local nonproduction build by SHA-256 before cutover.
- Switched `/srv/liftlog/nonprod/current` atomically to the new release.
- Root page: HTTP 200 with `Cache-Control: no-cache`.
- Client route `/programs`: HTTP 200.
- Hashed JavaScript and CSS assets: HTTP 200 with year-long immutable caching.
- Deployed HTML reports the exact application SHA `82e0048c6c2bc959d0b7dbc3717c0f62d7c0a389`.
- Browser smoke rendered the Lift Log development sign-in surface at mobile preview size.

Rollback was not required. If a regression is found, atomically point `/srv/liftlog/nonprod/current` back to `/srv/liftlog/nonprod/releases/20260827T191720Z`. The schema migration is forward-compatible with that frontend release; no database rollback is required for a frontend rollback.
