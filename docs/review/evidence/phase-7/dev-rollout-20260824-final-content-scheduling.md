# Hosted development rollout — final-content scheduling

Date: 2026-08-24

## Scope

- Development Supabase project: `ofyeejyfroblunbspgve` only.
- Development frontend: `https://dev.liftlog.cc` only.
- Production database and frontend were not changed.

## Applied migration

`202608250001_final_content_is_schedulable.sql` makes a published Own or Coach
program eligible for Calendar preparation directly. It retains the legacy
`program_availability` table for rollback compatibility and does not delete
programs, workouts, calendar history, or accounts.

## Frontend releases

- `20260824T232615Z`: compatible final-content scheduling frontend.
- `20260824T233658Z`: frontend-only Library filter simplification.
- `20260825T001500Z`: frontend-only exercises/programs model consolidation.
  Exercises now has Library and My exercises tabs; provided exercises open into
  details and can be copied into an independent personal exercise. Program
  templates are no longer fetched or exposed in the UI; stored legacy template
  records remain untouched for rollback compatibility.
- Release `20260825T001500Z` was rolled back after the product owner reported
  the development site unavailable. The current release is the prior known-good
  `20260824T233658Z`; the reverted release remains stored for diagnosis.
- Both are nonproduction builds only.

## Validation

- `npx supabase db lint --linked --project-ref ofyeejyfroblunbspgve`: clean.
- Full application suite: 113 legacy tests passed, 188 behavior tests passed,
  with one intentionally skipped integration test.
- HTTP smoke: root and client-side fallback returned `200`; hashed application
  asset returned immutable cache headers.
- Signed-in development smoke: a Final Own workout opened Calendar scheduling
  successfully; no calendar date was assigned or changed during the check.
- Library smoke: the idle screen presents only search and a Filters button;
  source, training style, category, and tags appear on demand.
- Release smoke: root and `/exercises` fallback returned `200`; the deployed
  `index-Cg0diHgZ.js` bundle returned `public, max-age=31536000, immutable`.
- Rollback smoke: root returned `200`, and both referenced assets
  (`index-D7HwJKXQ.js` and `index-KfS5-zWv.css`) returned `200`.
- Subsequent frontend work is deployment-blocked until explicit approval and
  runs at `http://localhost:3000` against hosted development Supabase project
  `ofyeejyfroblunbspgve`.
