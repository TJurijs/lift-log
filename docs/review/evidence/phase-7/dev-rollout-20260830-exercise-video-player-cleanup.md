# Development rollout: exercise video player cleanup

Date: 2026-08-30 UTC

- Application commit: `e6db1b7`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260830T000344Z`
- Retained rollback release: `/srv/liftlog/nonprod/releases/20260829T234244Z`
- Target: `https://dev.liftlog.cc`
- Hosted Supabase project: `ofyeejyfroblunbspgve`
- Database migrations: none
- Production changes: none

## Changes

- Simplified the in-app exercise video sheet and removed redundant labels and footer content.
- Removed YouTube playlist-loop parameters that exposed playlist thumbnails and navigation chrome.
- Kept muted autoplay from seven seconds and implemented looping through the YouTube player API.
- Retained a compact external YouTube action and close control in the sheet header.

## Pre-deployment gates

- `npm run ci:verify`: passed for the deployed application source.
- Lint and TypeScript checks: passed.
- Legacy suite: 153 passed, 1 expected skip, 0 failed.
- Behavior suite: 325 passed, 0 failed.
- Production build and all JavaScript/CSS bundle budgets: passed.
- `npm run build:nonprod`: passed from commit `e6db1b798e36d5c67fbf3ea8c8e8fe77dc6bc9ca`.
- The nonproduction bundle contains the development Supabase reference and no production reference.

## Deployment and smoke evidence

- Uploaded only `dist/` into the new immutable release directory.
- All 15 uploaded files matched the local nonproduction build by SHA-256 before cutover.
- Switched `/srv/liftlog/nonprod/current` atomically to the new release.
- Root page, client route `/programs`, and the deployed JavaScript asset returned HTTP 200.
- HTML retained `Cache-Control: no-cache`; the hashed asset retained immutable caching.
- Deployed HTML reports the exact application SHA `e6db1b798e36d5c67fbf3ea8c8e8fe77dc6bc9ca`.

Rollback was not required. If a regression is found, atomically point `/srv/liftlog/nonprod/current` back to `/srv/liftlog/nonprod/releases/20260829T234244Z`. No database rollback is required.
