# Technical review follow-up — 4 September 2026

This pass starts from `24a8515ff3462a2a43b8796ae58a56588d9dd0de` and builds on
the [earlier stabilization review](TECHNICAL_REVIEW_2026_09_04.md). The review
covered the tracked application, feature components, shared UI, authentication,
local persistence, repository/cache lifecycle, SQL authorization and read paths,
build configuration, deployment configuration, and test workflows. Independent
reviews covered persistence, data access, and UI; the extracted exercise feature
also received a separate review.

All live verification used the local UI and Docker Supabase. No hosted database,
deployment, migration, dependency upgrade, or payment integration was performed.
No database reset was needed. The SQL scale and authoring fixtures rolled back.

## Changes delivered

| Concern | Defect and resulting behavior |
| --- | --- |
| Abrupt-close recovery | An older asynchronous journal write could clear the synchronous mirror for a newer edit. Cleanup now checks that the mirrored snapshot is the one that has become durable. |
| Revision consistency | Recovery could pair the newly acknowledged revision with old session fields from React props. It now uses the controller's exact confirmed revision/snapshot pair. |
| Save feedback | A changed online draft could still display Saved during the autosave delay. It now displays Saving as soon as a changed snapshot is staged and returns to Saved after acknowledgement. |
| Completion and navigation | Delayed cleanup of a completed workout could disable a subsequently opened workout or release its writer lease before deletion settled. Cleanup captures its original scope and keeps the lease until that work finishes. |
| Storage failures | IndexedDB request/cursor failures could leave transaction rejection unobserved. Both failure paths are now handled. A blocked `sessionStorage` getter also no longer crashes telemetry initialization. |
| Account isolation | Disposing a repository used to invalidate pending reads in a way that restarted them. Disposed caches now reject their pending results without issuing replacement requests or applying old bootstrap side effects. |
| Fresh data after writes | Program, exercise, scheduling, and coaching mutations now invalidate their dependent cache entries. Bootstrap/coaching reads use the same validated coalescing path, so an old response cannot escape across a successful mutation. |
| Program selection | A cached selected/current version could live indefinitely. Mutable selectors expire after 30 seconds; explicit immutable revisions remain cached. Program name/description writes must return an affected row before success is reported. |
| Coaching access | Ending a coaching relationship clears cached content whose visibility depended on the relationship. Database RLS remains authoritative for fresh requests. |
| Exercise search | A user could click Load more during a new search's debounce interval and submit its old cursor with new filters. The extracted controller binds the cursor to the exact search, rejects obsolete responses, guards repeated clicks, and preserves pages on retry. |
| Exercise usability | Library/My exercises labels stay stable, loaded counts appear with results, selected filters expose their state, and empty searches provide a clear recovery action. Creating/copying an exercise clears the previous search so it can appear in My exercises. |
| Coach history | History rows repeatedly rebuilt the same run collection. One memoized index now serves the whole list. Exact assignment IDs are respected, and unavailable destinations do not render working-looking buttons. |
| Empty and partial lists | Personal/coach run lists now preserve loading, retry, and pagination controls even with no rows. Athlete search stays visible while its query is filtering a reduced list. |
| Shared interaction | Tabs remain keyboard reachable when the selected option disappears or is disabled. The My athletes tab now references an existing, correctly labelled panel during both loading and normal display. Redundant workout start actions are disabled while a start is pending. |
| Visual consistency | Coach and run views use existing 12px caption/13px control tokens and defined semantic colors. Finished-training disclosures have a visible chevron and a 44px target; actions wrap on narrow screens. Obsolete run-card CSS was removed. |

## Structure and design rules

The exercise library is now a separate lazily loaded feature:

- `app/features/exercises/ExercisesHome.tsx` owns the source tabs, filters,
  paged results, and empty states.
- `app/features/exercises/useExerciseSearch.ts` owns debounce, request scope,
  pagination, loading, and retry. Its repository dependency is limited to
  `searchExercises`, and results are delivered through a typed callback.
- `app/features/exercises/exercise-library.ts` holds the shared taxonomy and
  filter/presentation helpers used by both browsing and editing.

`LiftLogApp.tsx` is approximately 600 lines smaller. Existing behavior tests now
import the exercise view from its feature, and request lifecycle tests exercise
the controller directly. Source-contract tests were adjusted to read the new
module locations instead of retaining dead compatibility exports.

Future UI should keep the existing section responsibilities:

| Section | User purpose |
| --- | --- |
| Next workouts | Choose and log the next session; expand completed history when needed. |
| Programs | Create and reuse training content, with personal and coach-provided training distinguished. |
| Calendar | See and change dates for actual workout occurrences and open completed results. |
| Exercises | Find movements and maintain a reusable personal collection. |
| Coaching | Manage invited access, then review an athlete's Plan or History. |

Use the shared page header, tabs, dialog, async button, error, and status
components. Use the existing palette, spacing, radius, and text tokens. Keep
loading, empty, failure, and partial-result states distinct. A failed request
must leave existing rows usable and provide a retry for the failed operation.

## Verification and evidence

The production quality gate passed: lint, TypeScript, build, 204 legacy checks
(one intentional database-runner skip), 490 behavior tests, and bundle budgets.

Local Docker checks passed: integration authorization/isolation, V1 database
smoke, atomic authoring smoke, schema lint, and the rollback-only database scale
gate. Browser verification covered Chromium, Firefox, Android Chromium, and
mobile WebKit. The full matrix passed 20 applicable tests, with 20 cases skipped
by explicit environment/engine scope. Additional desktop/mobile checks covered
exercise-search recovery and coach Plan/History, including axe analysis and
horizontal-overflow assertions. Program authoring now also verifies persisted
renaming and description changes after reopening.

The compiled local app passed full offline reload in Chromium. WebKit full
offline navigation remains an existing engine exclusion; mobile WebKit covers
offline editing/reconnect, ordinary reload, and writer takeover. Screenshots of
desktop Programs and mobile exercise/coaching screens were visually inspected.

One final mobile writer-takeover cleanup encountered a real revision conflict
because the separate compiled-offline run briefly used the same local persona.
The isolated rerun passed. Test fixture writes must be serialized across these
suites, including when frontends use different localhost ports: database
revisions are shared while browser writer locks are origin-scoped.

The test helpers now wait for the successful save RPC matching the exact note
and acknowledged revision, rather than relying on a previous Saved indicator.
Fixture cleanup runs in finally blocks. The leaked synthetic note was restored
to the seed's empty value through the local UI and verified after a reload;
non-test notes are preserved.

On the final code, all four desktop Chromium/mobile WebKit persistence journeys
passed serially with the stronger acknowledgements. The rebuilt Chromium
offline-reload journey then passed separately and acknowledged its cleanup.

Local evidence is under ignored `artifacts/`:

- `review2-complete-quality.log`: final quality gate output.
- `review2-browser.log`: full browser matrix.
- `review2-final-browser.log`, `review2-final-browser-results/`: focused browser
  journeys and screenshots, including the diagnosed overlapping-fixture run.
- `review2-tab-recheck.log`: isolated mobile takeover verification.
- `review/harness-final-confirmed-saves.log`: final four persistence journeys
  with server-acknowledged fixture cleanup.
- `review2-confirmed-offline.log`: final compiled Chromium offline reload with
  server-acknowledged fixture cleanup.
- `review2-integration.log`, `review2-db-lint.log`: database verification.
- `performance/database-scale.json`: SQL plans, cardinalities, and rollback.
- `performance/review2-runtime-local.json`, `review2-runtime-gate.log`: compiled
  runtime measurements and successful budget evaluation.

## Performance limits

The database fixture included 50 athletes, 7,500 completed sessions, 5,000
exercises, and 50 program runs with 40 workouts each. Measured local execution:

| Operation | Time |
| --- | ---: |
| Create 50 runs | 411 ms |
| Schedule 50 × 40 workouts | 1,338 ms |
| History page | 0.39 ms |
| Calendar range | 1.01 ms |
| Exercise search | 1.01 ms |

The compiled runtime gate passed with zero page/console errors and zero attempted
writes. Across five warm iterations per screen, readiness p95 was 33–71 ms;
cold bootstrap was 839–850 ms. These measurements use loopback networking,
desktop Chromium, warmed repository caches, and blocked service workers. They
do not establish production concurrency limits or mobile field performance.

Production output remains within the existing budgets: about 421 kB initial JS,
168 kB largest async chunk, 800 kB total JS (224 kB gzip), and 120 kB CSS (22 kB
gzip). The central app chunk is smaller, but total compressed JS and CSS have
very little remaining headroom. Budgets were not increased.

## Remaining priorities and coach payments

1. The central app remains roughly 9,800 lines; repository and persistence
   orchestration are also large. Continue extracting program authoring,
   scheduling, and coaching controllers behind narrow feature interfaces.
   This pass reduces coupling but does not complete that architectural work.
2. Establish supported user counts with concurrent-client tests on the intended
   Supabase tier, including connection limits, realistic latency, and telemetry.
   The local scale checks prove bounded behavior for the tested fixture only.
3. The existing exercise Format filter translates formats into entry modes and
   tracking fields. Duration/Distance can overlap, and selecting several formats
   can broaden results. Exact format matching should be added to the server
   search predicate with cursor and migration coverage, rather than filtering
   already paginated results in the browser.
4. Retain the earlier review's limits on program-detail cardinality, append
   idempotency before adding automatic retries, and real-device offline testing.
5. Add coach payments as a separate server-owned billing domain: provider
   adapter, idempotent webhook receipts, purchase/subscription state, and a
   derived entitlement model. Keep coach relationships, content ownership, and
   immutable workout history independent of billing state. Define cancellation,
   refunds, past-due access, and payout ownership before implementing that
   schema. Keep provider secrets and authoritative prices off the client.

No payment functionality has been added or claimed ready in this cleanup.
