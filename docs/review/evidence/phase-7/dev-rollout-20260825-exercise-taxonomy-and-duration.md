# Development rollout — exercise taxonomy and workout duration summaries

- Date: 2026-08-25
- Application commit: `006c238`
- Target: `https://dev.liftlog.cc` and hosted development Supabase project `ofyeejyfroblunbspgve`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260825T102028Z`
- Retained rollback release: `/srv/liftlog/nonprod/releases/20260824T234303Z`

## Gate evidence

- The full local gate passed: 116 ordinary legacy tests, one intentional hosted-integration skip, and 209 behavior tests.
- `npm run build:nonprod` passed; the bundle contained the development project ref and no production project ref.
- HTTP smoke returned `200` for `/`, `/exercises`, and the deployed JavaScript asset. HTML retained `Cache-Control: no-cache`; the hashed asset retained immutable caching.
- Signed-in smoke loaded Next workouts, Programs, and Exercises against development Supabase.
- Programs displayed the finalized full-body and weightlifting workouts with their stored 80- and 90-minute durations.
- The deployed exercise form exposed separate controlled Training style and Category fields.

The rollout required no schema migration. Production frontend, production Supabase, and production data were untouched.
