# Dev rollout: stability, consistent UI and reliable local startup

Date: 2026-09-10 UTC

- Application commit: `701f897cb9e93e269790e79fd4ef4590e6408d2d`
- Target: https://dev.liftlog.cc
- Release: `/srv/liftlog/nonprod/releases/20260910T073000Z`
- Retained frontend rollback: `/srv/liftlog/nonprod/releases/20260905T004803Z`
- Database: `ofyeejyfroblunbspgve` (development only)
- Applied migrations: `202609070001` through `202609070005`, preserving the existing 79 migration entries.
- Production changes: none.

The release contains the reviewed stability, authoring, navigation, action/icon,
mobile layout, and maintainability changes. Windows Docker startup passed again.
The clean GitHub runner exposed an additional first-install timeout: initial
Supabase image downloads now have a bounded 15-minute allowance, while existing
installation restarts retain their shorter bounds. Killed CLI processes cannot
be mistaken for success. Fifteen focused startup regression tests passed locally.

## Release validation

[GitHub Actions run 34449954402](https://github.com/TJurijs/lift-log/actions/runs/34449954402)
passed both required jobs before database promotion and frontend activation:

- Lint, TypeScript, production build, legacy and behavior tests, bundle budgets.
- Database integration, concurrency/authoring contracts, portable migration
  replay, telemetry boundaries, schema inventory and backup/restore rehearsal.
- Desktop Chromium and mobile WebKit journeys: 26 passed, 10 intentional skips.
- Built-app offline/mobile-preview checks: 3 passed; runtime performance gate passed.

A fresh nonprod build used the exact application commit and development project.
The bundle had no production project reference or secret credential values.
All 23 uploaded static files matched local SHA-256 digests before activation.
The nonprod current symlink switched atomically after verifying its previous target.

Live HTTPS checks passed for the root, SPA fallback, JavaScript asset and service
worker. The release meta tag matched the application commit. HTML is `no-cache`,
hashed assets are immutable, and development framing remains `SAMEORIGIN`.

Authenticated live browser checks at 1440 and 390 pixels passed sign-in,
Programs/Exercises/Calendar/Next navigation, a loaded program detail and sign-out,
with no page errors or document overflow. The hosted-development integration
suite passed its isolated-fixture authorization, invitation, program and scheduling
checks, including writes and fixture cleanup.

## Database recovery and operations

Before promotion, a private custom-format archive of development Auth, public,
private and migration schemas/data was saved outside version control. Archive
size: 1,013,438 bytes; SHA-256:
`ff789e6784ee64d5ddec3304dc177c6ffc45ea1807e6537fbdcb913628207df5`.
It restored successfully into a disposable local database, including 13 accounts
and 79 migration entries. Only provider-owned future DEFAULT ACL templates were
omitted from that local restore; the original archive retains them. The temporary
database was removed. This verifies the application archive, not hosted-provider
PITR, OAuth or storage recovery.

The five forward migrations applied successfully. The telemetry retention job
is active on a 15-minute schedule; browser telemetry remains disabled by default.
The previous static release remains available for frontend rollback. These SQL
changes are retained during frontend rollback; no destructive database rollback
or account reset was performed.

Private backup, browser screenshots and detailed reports remain under ignored
`artifacts/dev-release-20260910/`; no credentials or account archives were pushed.
