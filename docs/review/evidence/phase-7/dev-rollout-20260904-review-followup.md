# Development rollout: technical review follow-up

Date: 2026-09-04 UTC

- Application commit: `b29e88fb849b8aea9811272e18b04b4929400d24`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260904T204730Z`
- Retained frontend rollback release: `/srv/liftlog/nonprod/releases/20260904T183156Z`
- Target: `https://dev.liftlog.cc`
- Hosted Supabase project: `ofyeejyfroblunbspgve`
- Database changes in this rollout: none
- Production changes: none

## Changes

The [technical review follow-up](../../TECHNICAL_REVIEW_FOLLOWUP_2026_09_04.md)
documents the persistence/recovery fixes, cache lifecycle and invalidation,
exercise feature extraction and search pagination, and coaching/UI consistency
changes included in this application release.

## Pre-deployment gates

- The final local `ci:verify` gate passed: lint, TypeScript, production build,
  204 legacy checks plus one intentional skip, 490 behavior tests, and bundle
  budgets.
- Local UI and Docker Supabase integration, authoring, scale, browser, offline,
  and runtime checks passed as detailed in the linked review.
- A fresh `npm run build:nonprod` passed on the application commit above.
  Bundle budgets passed without changes to thresholds.
- The build contained the exact development site/Supabase binding, with no
  production project ref or local Supabase URL.
- Hosted development migration history matched all 80 local migrations through
  `202609040003`. No migration was applied during this rollout.

## Deployment and live verification

- Uploaded only the 24 files from `dist/` to the new release directory.
- All 24 uploaded files matched their local SHA-256 hashes before cutover.
- Applied directory mode `0755` and file mode `0644`.
- Confirmed the preceding `current` target before switching the symlink
  atomically. The preceding release remains available for rollback.
- `/` and SPA route `/programs` returned HTTP 200 and identical HTML containing
  the full application release SHA above.
- HTML and `/sw.js` returned `Cache-Control: no-cache`. All 18 JavaScript/CSS
  assets referenced by the worker returned HTTP 200 with immutable caching.
- Public assets used the development Supabase ref and contained no production
  ref. HSTS, nosniff, and referrer-policy headers were present.
- Development Supabase Auth health returned HTTP 200.
- Signed-in live smoke checks passed in desktop Chromium and mobile WebKit
  using the existing disposable coach fixture. Both covered Next workouts,
  Programs, Calendar, Exercises, Coaching, My athletes, and sign-out.
- Both browser runs reported zero page/console errors, HTTP errors, unexpected
  origins, or attempted data writes. Screens had no horizontal overflow, and
  the desktop/mobile coaching screenshots were visually inspected.

The hosted smoke uses seeded password authentication; it does not repeat the
interactive Google OAuth consent flow. Browser service workers were blocked
for isolated navigation checks. Local compiled offline verification is recorded
in the technical review.

## Evidence

Ignored local release artifacts are under `artifacts/deploy-dev/`: the release
manifest and `SHA256SUMS`, bundle report, signed-in browser smoke JSON/log,
and desktop/mobile screenshots. Build and migration-list logs are
`artifacts/deploy-dev-build.log` and `artifacts/deploy-dev-migrations.log`.

Application CI: [run 33917919083](https://github.com/TJurijs/lift-log/actions/runs/33917919083)
passed both `verify` and `local-supabase`, including database contracts/scale,
desktop/mobile journeys, offline reload, and navigation/detail performance.

## Rollback

Atomically repoint `/srv/liftlog/nonprod/current` to
`/srv/liftlog/nonprod/releases/20260904T183156Z`, then repeat the release metadata,
route, asset, and authentication checks. This rollout did not change the
database. Retain both release directories until the development review is
complete.
