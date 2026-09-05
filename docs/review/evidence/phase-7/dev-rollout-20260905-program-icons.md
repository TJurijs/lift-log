# Development rollout: program icon consistency

Date: 2026-09-05 UTC

- Application commit: `70405cc084438abdcf945c5ee93da45439358877`
- Target: `https://dev.liftlog.cc`
- Release: `/srv/liftlog/nonprod/releases/20260905T002541Z`
- Retained rollback: `/srv/liftlog/nonprod/releases/20260904T215439Z`
- Database, Nginx, and production changes: none

Program lifecycle controls now use the calendar-plus icon consistently. This
includes starting a program from the program catalogue and opening active
program progress from catalogue and compact run cards. Standalone workouts keep
the activity icon.

Verification:

- ESLint and the localdev TypeScript/Vite build passed against the running local
  Docker Supabase environment.
- The fresh nonproduction build passed the bundle budget gate and contained the
  development Supabase project reference with no production reference.
- The deployed application asset SHA-256 matched the local nonproduction build.
- Root and client-side routes returned `200`; static assets retained immutable
  caching and the mobile-preview response retained `X-Frame-Options: SAMEORIGIN`.
- A signed-in 393-pixel mobile preview confirmed `lucide-calendar-plus` on both
  the active-program badge and Start program action.

Rollback is an atomic repoint of nonprod `current` to
`/srv/liftlog/nonprod/releases/20260904T215439Z`. No database rollback is
required.
