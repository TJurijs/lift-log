# Dev rollout: consistent program actions

Date: 2026-09-05 UTC

- Application commit: `37b6c8fe02d4ba8618332b2ca0c6329f341b42e2`
- Target: `https://dev.liftlog.cc`
- Release: `/srv/liftlog/nonprod/releases/20260905T004803Z`
- Retained frontend rollback: `/srv/liftlog/nonprod/releases/20260905T003854Z`
- Hosted development Supabase: `ofyeejyfroblunbspgve`
- Migration: `202609050001_copy_readable_program_versions.sql`
- Production changes: none

Copy and Schedule are available on every visible reusable program and workout.
Edit and Delete remain available only for an editable item with no active run.
The four semantic action slots keep each icon at a stable horizontal position.

Validation:

- Local Docker Supabase passed a full reset, schema lint, and authenticated
  integration suite with the migration applied.
- Forty-two capability tests and three focused program-card contract tests passed.
- ESLint, exact local and nonprod builds, and every performance budget passed.
- The migration list confirmed `202609050001` on the hosted development project.
- Root and `/program` returned HTTP 200 and the active release SHA matched.
- Signed-in 393-pixel UI inspection confirmed both active programs show Copy in
  column 2 and Schedule in column 3. The unused workout shows Edit, Copy,
  Schedule, and Delete in columns 1 through 4 respectively.

Frontend rollback is an atomic repoint of nonprod `current` to
`/srv/liftlog/nonprod/releases/20260905T003854Z`. The database change is
backward-compatible with that frontend.
