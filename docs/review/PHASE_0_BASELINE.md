# Phase 0 baseline — 2026-08-24

This report freezes the verified state before application-source changes. It distinguishes existing failures from later regressions and excludes credentials, local keys, and persona passwords.

## Scope and environment

- Repository: `lift-log-app`
- Branch: `main`, tracking `origin/main`
- Commit: `661817edecabda6b4853af90c51fe4fb87076201` (`Refine workout logging and exercise library`)
- Initial worktree: clean except for the user-provided, untracked `docs/MAJOR_REVIEW_CLEANUP_TESTING_GUIDE.md`
- Node: `v22.15.0`
- npm: `10.9.2`
- Supabase CLI: `2.115.0`
- Docker CLI: `28.3.2`
- Active browser-test mode after user direction: Vite `nonprod` at `http://localhost:3000`, connected to the hosted `liftlog-dev` Supabase project
- Authenticated baseline persona: Raimonds Vējonis, a fictional dual athlete/coach test account
- Production data and deployment were not touched.

The local Supabase sequence had already been attempted before testing was redirected to hosted development. The local stack and Docker Desktop were then stopped. No later database command was run locally, and hosted mutations remain limited to the isolated test-persona namespace.

## Existing validation results

| Command | Result | Duration/evidence |
| --- | --- | --- |
| `npm ci` | Pass | 342 packages installed in 11.8 s; npm reported 7 development-only vulnerabilities. |
| `npm audit --omit=dev` | Pass | 0 production dependency vulnerabilities. |
| `npm audit` | Fail | 7 development dependency findings: 2 low and 5 high. A forced Vite update would move outside the declared range. |
| `npm run lint` | Fail | 10 errors in 29.3 s: 4 unused symbols in `LiftLogApp.tsx`, 2 synchronous effect state updates, 1 unassociated label, 1 `autoFocus`, and 2 test lint errors. |
| `npx tsc --noEmit` | Pass | 4.1 s. |
| `npm test` | Pass with skip | 71 registered tests: 70 pass, 0 fail, 1 skipped; 10.7 s including build. |
| `npm run build:nonprod` | Pass with warning | 4.0 s; one JavaScript chunk exceeds 500 kB. |
| Initial `npm run db:start` | Environment failure, then pass | Docker engine was initially stopped. After the engine was started, local Supabase started successfully. This path was superseded by the user's hosted-dev direction. |
| Initial `npm run db:reset` | Pass | All 34 migrations applied to the disposable local database. |
| Initial `npm run seed:test-population:local` | Pass | Verified 9 personas and 5 active coaching relationships. |
| Initial `npm run test:integration` | Fail | Pre-existing assertion failure at `tests/supabase.integration.test.mjs:287`: `libraryOccurrences.length > 0` was false. |
| Initial `npm run db:lint` | Pass | No schema errors. |

The integration scenario is intentionally loopback-only and performs direct destructive cleanup. It must not be repointed to hosted development. With the later no-Docker direction, that test layer remains an explicit execution gap.

## Build and source profile

| Surface | Verified baseline |
| --- | --- |
| Production-mode app JavaScript | 658.54 kB minified / 179.98 kB gzip |
| Nonproduction app JavaScript | 663.56 kB minified / 181.56 kB gzip |
| CSS | 96.59 kB minified / 18.02 kB gzip |
| `app/LiftLogApp.tsx` | 9,251 lines / 296,134 bytes / 114 `useState` occurrences / 132 raw `<button>` tags |
| `app/globals.css` | 5,494 lines / 109,393 bytes |
| `lib/repository.ts` | 2,608 lines / 90,392 bytes |
| `app/ui-primitives.tsx` | 203 lines / 4,380 bytes |

The build warning, monolithic bundle, and source hotspots all reproduce the guide's documented baseline.

## Test safety-net profile

- 27 `*.test.mjs` files register 71 cases.
- 59 of 71 cases (83.1%) are source-string or structural contracts.
- Only the 8 `workout-focus.test.mjs` cases substantially execute ordinary application logic.
- The one 1,059-line database scenario is skipped by the ordinary suite and aborts all later assertions after the first failure.
- The repository exposes 38 distinct RPC names; the integration scenario overlaps only 13, leaving 25 repository RPC categories uncovered.
- There is no checked-in component render runner, browser E2E runner, visual regression runner, runtime accessibility audit, coverage configuration, load test, or CI workflow.

## Hosted-development browser baseline

The existing authenticated Raimonds Vējonis browser session was used read-only. The console contained no warning or error entries while visiting Next workouts, Programs, Calendar, Exercises, Coaching/My coaches, and Coaching/My athletes.

Three desktop reloads from navigation start until the `Next workouts` heading became visible measured:

| Run | Reload-to-ready |
| --- | ---: |
| 1 | 2,481 ms |
| 2 | 974 ms |
| 3 | 943 ms |

These are browser-observed readiness timings on the current network, not shaped mobile-4G percentiles. The workspace loader was statically verified to start 12 parallel branches and conditionally fan out into many more Data API calls. Exact request bytes, main-thread time, and memory were not exposed by the in-app browser runtime; behavior-neutral instrumentation must be added before performance optimization so those baselines are not invented.

## Mobile and accessibility observations

At a 360 × 800 CSS-pixel viewport:

- Next workouts had `scrollWidth === clientWidth` (360 px), so no document-level horizontal overflow was present.
- Scrollable pages also kept `scrollWidth === clientWidth`; the 15 px scrollbar reduced the content client width to 345 px.
- The eager exercise library rendered all 144 global exercises and produced a 7,271 px document.
- Computed text reached 6 px; bottom-navigation text was 8.5 px and several metadata labels were 8–10 px.
- Three currently visible controls were below the 44 px target: Switch persona (36 px high), the LL home control (34 × 34), and the account control (34 × 34).
- Program source tabs all omitted `tabindex`; pressing ArrowRight on the selected Library tab did not change selection.
- Main navigation exposes no `aria-current` state.
- The account dialog did focus its Close button, locked body scrolling, closed on Escape, and restored body scrolling. Preserve this working behavior.
- Calendar semantics expose interactive workout/remove buttons inside interactive day buttons; this is invalid nested interaction and a keyboard/touch risk.
- Calendar deletion is currently hover-oriented, and the compact month view has no selected-day agenda visible in the first mobile viewport.

## Screenshots

Desktop 1440 × 900:

- [Next workouts](evidence/phase-0/next-workouts-desktop-1440x900-viewport.png)
- [Programs](evidence/phase-0/programs-desktop-1440x900.png)
- [Calendar](evidence/phase-0/calendar-desktop-1440x900.png)
- [Exercises](evidence/phase-0/exercises-desktop-1440x900.png)
- [Coaching — My coaches](evidence/phase-0/coaching-desktop-1440x900.png)
- [Coaching — My athletes](evidence/phase-0/coaching-athletes-desktop-1440x900.png)

Mobile 360 × 800:

- [Next workouts](evidence/phase-0/next-workouts-mobile-360x800.png)
- [Programs](evidence/phase-0/programs-mobile-360x800.png)
- [Calendar](evidence/phase-0/calendar-mobile-360x800.png)
- [Exercises](evidence/phase-0/exercises-mobile-360x800.png)
- [Coaching — My athletes](evidence/phase-0/coaching-athletes-mobile-360x800.png)

## Baseline gates and gaps

Pre-existing blockers:

1. Lint fails with 10 errors.
2. The explicit local database integration scenario fails before most of its assertions run.
3. Development dependencies contain five high-severity audit findings, while production dependencies are clean.
4. Behavioral, component, browser, accessibility, visual, performance, load, and CI infrastructure is absent.
5. Precise request/payload/main-thread/memory measurements require new observability before optimization.
6. With hosted-dev/no-Docker testing, destructive RLS, scale, and migration verification cannot be performed unless an equivalently isolated nonproduction database target is provided.

No application source had been changed when these measurements and screenshots were captured.
