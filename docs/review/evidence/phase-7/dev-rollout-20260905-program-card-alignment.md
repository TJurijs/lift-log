# Dev rollout: mobile program card alignment

Date: 2026-09-05 UTC

- Application commit: `e346d434c481c4daf9ecbd01f995f8e23286906e`
- Target: `https://dev.liftlog.cc`
- Release: `/srv/liftlog/nonprod/releases/20260905T003305Z`
- Retained rollback: `/srv/liftlog/nonprod/releases/20260905T002541Z`
- Database, Nginx, and production changes: none

Program cards now place the workout count and active-run progress in one
non-wrapping status row. Mobile action controls use three stable semantic slots:
template edit or duplicate, schedule, and delete. Missing actions leave their
slot empty, so matching controls keep the same horizontal position between cards.

Validation:

- The focused program card contract test passed (3 tests).
- ESLint and the exact nonprod TypeScript/Vite build passed.
- All performance budgets passed, including CSS at 119,962 raw bytes and 21,788
  gzip bytes.
- Root, `/program`, and the deployed hashed JavaScript and CSS assets returned
  HTTP 200.
- A signed-in 393-pixel mobile preview measured both status rows at 28 pixels
  high with `white-space: nowrap` and no horizontal overflow. Both cards placed
  the template action at x=210 and schedule action at x=259; delete occupies the
  third slot at x=308 when available.
- The 412-pixel preview also kept the status row at 28 pixels with no overflow.

Rollback is an atomic repoint of nonprod `current` to
`/srv/liftlog/nonprod/releases/20260905T002541Z`. No database rollback is
required.
