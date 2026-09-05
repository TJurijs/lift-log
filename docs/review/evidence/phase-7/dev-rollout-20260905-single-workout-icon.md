# Dev rollout: single-workout start icon

Date: 2026-09-05 UTC

- Application commit: `64495500f18ab1163fe6e46752e5d5cd61578206`
- Target: `https://dev.liftlog.cc`
- Release: `/srv/liftlog/nonprod/releases/20260905T003854Z`
- Retained rollback: `/srv/liftlog/nonprod/releases/20260905T003305Z`
- Database, Nginx, and production changes: none

The Start action on reusable single-workout cards now uses the same calendar-plus
icon as the equivalent program action.

Validation:

- Sixteen focused calendar and program-card UI contracts passed.
- ESLint, the exact nonprod build, and every performance budget passed.
- Root, `/program`, and the deployed hashed application assets returned HTTP 200.
- A signed-in 393-pixel mobile preview confirmed `lucide-calendar-plus` inside
  the `Start Elina — General Fitness` action.

Rollback is an atomic repoint of nonprod `current` to
`/srv/liftlog/nonprod/releases/20260905T003305Z`. No database rollback is
required.
