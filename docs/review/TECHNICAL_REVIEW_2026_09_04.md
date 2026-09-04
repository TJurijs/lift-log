# Technical review and cleanup — 4 September 2026

This pass reviewed application state and authentication, workout persistence,
repository queries, database authorization and migrations, navigation, shared UI,
feature components, build output, and test/CI workflows. Work started from
`d98189fec33d4210e26d1a424194a1997a1daa03`. The review and verification used
only the local UI and local Docker Supabase; hosted rollout evidence is recorded
separately when the reviewed revision is deployed.

The result fixes concrete data-loss, incomplete-data, authorization, navigation,
and accessibility defects while preserving the existing product model. Local
validation passes. This is evidence of improved correctness and bounded query
behavior; it is not a production concurrent-user capacity certification.

## Implemented fixes

| Area | Problem and resulting behavior |
| --- | --- |
| Workout persistence | Async initialization, retries, recovery, and staging could outlive their session. Work is now scoped to the current session and account. Successful saves no longer exhaust the conflict retry budget. |
| Multiple tabs | Two tabs could write the same local journal sequence. An exclusive Web Lock now owns the workout writer until pending work settles. Other tabs show a disabled logger and an explicit takeover retry. |
| Full offline reload | Cached local edits were paired with the last server revision, causing a same-revision snapshot conflict on reload. The workspace now stores the confirmed snapshot/revision pair; the durable journal restores newer local edits after the writer lock is acquired. Older bootstrap responses cannot replace a newer acknowledged revision. |
| Offline app shell | The service worker now caches only public build assets, separates caches by release and asset manifest, and falls back on network or HTTP failures. Cached HTML stays paired with its installed assets instead of being overwritten by a different deployment's HTML. |
| Authentication | Rejected session restore and OAuth calls show recoverable errors. Failed sign-out preserves the usable repository. Old async responses cannot clear the next account; coach invitation context survives OAuth. |
| Program authoring | Adding a workout or exercise now runs in one database transaction, including required structural rows and default prescriptions. Parent locks serialize positions and publication checks. Failed writes leave no partial content. |
| Exercise visibility | A draft owner could attach another user's private exercise UUID through direct writes. INSERT RLS and a changed-reference UPDATE check close both paths while preserving legitimate immutable snapshots copied by authorized coach flows. |
| Query cache | Callers joining a request now receive its validated settlement. An invalidated in-flight response cannot escape as stale data to a coalesced caller. |
| Large history | Completed workout entries load beyond Supabase's first 1,000-row response. Entries are grouped once by log ID. Both calendar streams follow date/ID cursors beyond the first page, including many completions on the same day. |
| History usability | Completed history has explicit older-page loading, recoverable errors, preserved existing rows, and stale-request protection. No-match program searches can still request older programs. |
| Navigation | Returning to Programs clears the editor/detail state even when the URL hash is unchanged. Delayed detail loads cannot reopen a program after the user navigates elsewhere. |
| UI consistency | Calendar uses the shared page header and includes in-progress workouts. Shared text sizes replace undersized labels; progress colors use existing design tokens. Status pills accommodate wrapping. Dates use one date-only formatter. |
| Dialog usability | Focus remains stable when callbacks change, the trap excludes hidden/disabled controls, nested Escape closes only the top dialog, and nested scroll locks restore correctly. An empty scheduling date remains editable. |
| Structure and performance | NextWorkoutsView and its history controller are feature modules; the view loads lazily. Program styles moved out of the component. Exercise search runs only for an open editable picker. Forty-five unused CSS rules were removed. |
| Verification | Browser tests default to loopback UI/Supabase, with external-request blocking for authenticated tests. Local CI now exercises authoring, draft recovery, multiple tabs, and compiled offline reload. Generated artifacts are excluded from lint. |

## Database changes and rollout

The following migrations were applied successfully to local Docker Supabase:

1. `202609040001_atomic_authoring_appends.sql`
2. `202609040002_calendar_history_cursor.sql`
3. `202609040003_exercise_reference_visibility.sql`

Apply these migrations through the normal Supabase migration workflow before
deploying the new frontend: it calls the new append RPCs and calendar signature.
These are versioned migrations, not scripts intended for arbitrary reexecution.
They do not delete existing workout history or published content.

## Verification performed

- `npm run ci:verify`: lint, TypeScript, production build, 204 legacy checks
  (one intentional database-runner skip), 451 behavior tests, and bundle budgets
  passed. This includes the final delayed-navigation regressions.
- Local integration, V1 database smoke, authoring database smoke, and schema lint
  passed. Real SQL tests include atomic rollback, ordering/defaults, immutable
  published versions, athlete isolation, revoked coach access, anonymous denial,
  private exercise references, and authorized coach copies.
- The full local browser matrix passed 20 tests across desktop Chromium, Firefox,
  Android Chromium, and mobile WebKit; 16 cases were intentionally skipped by
  environment/engine scope. After the offline persistence fix, all eight focused
  desktop Chromium/mobile WebKit journeys passed again.
- Authenticated browser checks covered Next workouts, Programs, Calendar,
  Exercises, and Coaching, with one main heading, no horizontal overflow, no
  uncaught page errors, and no serious or critical axe findings. Public/mobile
  tests also cover 320, 360, 390, 430, and 768 CSS-pixel widths.
- A separately compiled local app passed a full network-offline reload in
  Chromium: the saved local note returned, editing remained enabled, reconnect
  synchronized it, and the original fixture note was restored.
- Desktop and mobile authoring tests created, saved, reopened, and removed a
  temporary program. Draft tests restored fixture notes. The four temporary
  programs left by earlier failed attempts were soft-archived using the normal
  owner-authorized database function.

The Windows bundled WebKit engine failed full offline navigation with an internal
engine error before the page could reload. That specific test is explicitly
skipped on Windows WebKit; WebKit offline editing, reconnect, regular reload, and
two-tab takeover passed. The compiled offline test is included for Chromium and
WebKit in Linux CI. Real iPhone/iPad offline navigation, assistive technology,
soft-keyboard behavior, and minimum browser versions still need device validation
as described in [browser support](../BROWSER_SUPPORT.md).

### Performance evidence

The rollback-only local database fixture exercised 50 athletes, a shared
40-workout program, 320 workout items, 960 prescriptions, 5,000 exercises,
7,500 completed sessions, 50 program runs, and 2,000 run workout slots.

| Local operation | Measured execution |
| --- | ---: |
| Create 50 program runs | 324 ms |
| Schedule 50 runs × 40 workouts | 730 ms |
| History page of 50 | 0.45 ms |
| 93-day calendar query | 1.06 ms |
| Exercise search page of 50 | 1.49 ms |

The scale harness now enforces read-only transactions for read assertions.
Rejecting every WAL byte was incorrect: PostgreSQL SELECTs may generate WAL for
hint-bit/full-page maintenance. The harness retains the actual WAL measurements
and rejects actual writes in read-only mode. See PostgreSQL's
[WAL configuration documentation](https://www.postgresql.org/docs/16/runtime-config-wal.html).

The compiled local navigation/detail performance gate passed, with zero page or
console errors and zero attempted writes. Across five warm iterations per screen,
measured readiness p95 was 33–65 ms; cold bootstrap was 810–832 ms. These are
loopback desktop measurements with warm repository caches and service workers
blocked by the performance harness, not WAN latency or field Core Web Vitals.

Bundle gates passed: initial JavaScript about 421 kB raw / 120 kB gzip, largest
async chunk about 174 kB / 44 kB, total JavaScript about 795 kB / 222 kB, and CSS
about 120 kB / 22 kB. CSS and async JavaScript have little budget headroom; keep
new features separately loaded and retire obsolete styles.

Local evidence is retained under ignored `artifacts/`:

- `review-final-verify.log` — complete quality gate output.
- `review-e2e.log` — full browser matrix.
- `review-final-browser.log` and `review/final-browser-results/` — final focused
  desktop/mobile journeys and screenshots.
- `performance/database-scale.json` — plans, fixture bounds, and rollback result.
- `performance/runtime-local.json` — read-only browser timings and request counts.
- `review/offline-tests/` — compiled offline browser test output.

Visual examples are stored locally under the ignored
`artifacts/review/final-browser-results/` directory, including mobile Programs,
desktop Coaching, and the recovered mobile workout.

Docker Desktop initially could not start because of stale runtime socket state.
Its runtime directory was preserved as
`%LOCALAPPDATA%/Docker/run.stale-20260904`, and a fresh `run` directory allowed
startup. Database volumes were retained. The local development UI and Supabase
were left running for continued review.

## Remaining engineering work

1. **Continue reducing the central component and repository.** LiftLogApp is still
   roughly 10,400 lines and repository.ts roughly 3,800. Extract program editing,
   scheduling, and coaching orchestration into feature controllers behind narrow
   repository interfaces. The extracted history controller and pure persistence
   helpers establish a tested pattern; avoid adding billing logic to the central
   component.
2. **Measure real capacity before a large rollout.** This pass proves fixtures,
   bounds, and local query behavior. A representative concurrent-user test on the
   intended database tier, connection limits, slow-client latency, and production
   telemetry are still necessary to set a supported user count.
3. **Make append retries idempotent if automatic retry is introduced.** The new
   authoring calls are atomic, but a lost successful response followed by a manual
   retry can create a second complete workout/exercise. Do not automatically retry
   these calls without a stable request key and server-side receipt.
4. **Keep large-data bounds explicit.** Calendar collection has a 100-page safety
   ceiling and reports an error rather than showing incomplete results. Completed
   detail still uses multiple requests; a dedicated summary/detail RPC could
   reduce round trips. Existing program-detail limits and documented maximum-size
   requirements should be reconciled before expanding supported program sizes.
5. **Prefer behavioral tests as modules move.** Numerous inherited tests inspect
   source strings. They remain useful contract alarms but are brittle during
   extraction. New tests in this pass exercise races, database authorization,
   recovery, and actual browser journeys; continue replacing source-coupled checks
   when their owning features change.

## Preparing for coach payments

No payment feature was added. Build it as a separate billing domain with a
server-side provider adapter, subscriptions/purchases, idempotent webhook receipts,
and an explicit entitlement projection. Coaching relationships and program
ownership should remain separate from payment status. Enforce entitlements in
server functions/RLS; the browser should only display them and request a hosted
checkout session. Keep provider secrets and authoritative price/amount decisions
on the server. Define cancellation, refunds, past-due access, and coach payout
ownership before choosing the final schema.

The existing immutable program versions, scoped coaching authorization, narrow
feature interfaces, and transactional database operations are useful foundations.
The next structural step is extracting coaching/application orchestration before
introducing this additional domain.
