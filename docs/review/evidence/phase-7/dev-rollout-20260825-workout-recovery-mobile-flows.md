# Development rollout: workout recovery and mobile flows

Date: 2026-08-25 UTC

- Application commit: `e509d58`
- Active frontend release: `/srv/liftlog/nonprod/releases/20260825T211411Z`
- Retained rollback release: `/srv/liftlog/nonprod/releases/20260825T123226Z`
- Target: `https://dev.liftlog.cc`
- Hosted Supabase project: `ofyeejyfroblunbspgve`
- Database migrations: none
- Production changes: none

## Pre-deployment gates

- Legacy suite: 124 passed, 1 skipped, 0 failed.
- Behavior suite: 263 passed, 0 failed.
- `npm run build:nonprod`: passed.
- `git diff --check`: passed.
- Bundle target check: dev Supabase reference present; production reference absent.

## Deployment and smoke evidence

- Uploaded only `dist/` into the immutable release directory.
- Switched `/srv/liftlog/nonprod/current` atomically to the new release.
- Root page: HTTP 200.
- Client route `/programs`: HTTP 200.
- JavaScript asset: HTTP 200 with `public, max-age=31536000, immutable`.
- Live and local `index.html` SHA-256 matched: `1B2249F94DF3559EA93297ED374E4C37117E32965E75BBFAFDC84F8F225E43B2`.
- Signed-in browser smoke rendered the Lift Log workspace and the Next, Programs, Calendar, Exercises, and Coaching navigation.

Rollback was not required. If a regression is found, atomically point `/srv/liftlog/nonprod/current` back to `/srv/liftlog/nonprod/releases/20260825T123226Z`.
