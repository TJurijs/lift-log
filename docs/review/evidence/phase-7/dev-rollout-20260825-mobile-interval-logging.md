# Development rollout — mobile and interval workout logging

- Date: 2026-08-25
- Application commit: `1e36ea9`
- Target: `https://dev.liftlog.cc` and hosted development Supabase project `ofyeejyfroblunbspgve`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260825T123226Z`
- Retained rollback release: `/srv/liftlog/nonprod/releases/20260825T102028Z`

## Changes

- Compact mobile strength-set logging, numeric actual-RPE display, and a one-line prescription summary.
- Per-round interval execution with a five-column responsive grid and revisioned per-round persistence.
- Current-version and unscheduled-only filtering in the scheduling picker.
- Safe active-session reset handling and separate owner/coach historical-program read paths.
- Development migration `202608250002_interval_round_session_entries.sql`, which permits ordered multi-entry interval drafts while retaining the single-entry invariant for ordinary result items.

## Gate evidence

- `npm test` passed: 119 ordinary legacy tests, one intentional integration skip, and 211 behavior tests.
- `npm run build:nonprod` passed. The output contained the development project reference and no production project reference.
- The linked hosted-development database is synchronized through migration `202608250002`.
- The broad hosted integration runner reached an obsolete library-program availability assertion and failed before its session-writing checks. The interval payload, migration contract, access boundaries, and revisioned persistence paths passed their focused tests; this unrelated integration fixture mismatch remains recorded rather than suppressed.
- HTTP smoke returned `200` for `/`, `/exercises`, the entry asset, and the lazy-loaded application asset.
- HTML retained `Cache-Control: no-cache`; hashed assets retained `Cache-Control: public, max-age=31536000, immutable`.
- Signed-in smoke loaded Next workouts, Programs, and Exercises against hosted development Supabase.
- Signed-in responsive smoke at `393 × 852` rendered the mobile header, workout card, and bottom navigation without horizontal overflow.
- Uploaded asset SHA-256 hashes matched the local nonproduction build before smoke testing.

Production frontend, production Supabase, and production data were untouched.
