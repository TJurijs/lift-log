# Development rollout: program lifecycle and coaching workflow

Date: 2026-09-02 UTC

- Application commit: `0507717`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260902T001738Z`
- Retained frontend rollback release: `/srv/liftlog/nonprod/releases/20260830T000344Z`
- Target: `https://dev.liftlog.cc`
- Hosted Supabase project: `ofyeejyfroblunbspgve`
- Database migration: `202609020001_simple_content_lock_lifecycle.sql`
- Production changes: none

## Changes

- Simplified programs and quick workouts to editable-until-first-use lifecycle semantics.
- Simplified the coaching overview to assigned programs with contextual progress.
- Separated coach assignment from calendar scheduling.
- Added athlete and assigning-coach unassignment while preserving completed history.
- Standardized desktop detail navigation with the mobile back/title/action pattern.

## Pre-deployment gates

- `npm run ci:verify`: passed.
- Legacy suite: 157 passed, 1 expected integration skip, 0 failed.
- Behavior suite: 325 passed, 0 failed.
- Production build and bundle budgets: passed.
- Nonproduction build validated the exact development site and Supabase bindings.

## Deployment evidence

- The migration was applied transactionally to `liftlog-dev`; migration history reports local and remote `202609020001` aligned.
- Uploaded only the 15 files from `dist/` into a new immutable release.
- Every uploaded file matched the local SHA-256 hash before cutover.
- Switched `/srv/liftlog/nonprod/current` atomically to the new release.
- Root, SPA route `/programs`, and the deployed JavaScript asset returned HTTP 200.
- HTML is served with `Cache-Control: no-cache`; the hashed asset is immutable.
- The deployed JavaScript contains application release SHA `0507717`.

The preceding frontend release remains available for an atomic static rollback. Because this rollout changes database lifecycle semantics, a frontend rollback does not reverse the applied migration.
