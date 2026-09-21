# Unified Training review — September 21, 2026

## Approved behavior

Training is the app's home. Every created workout/program belongs there immediately, including when it has no date. There is no separate Next destination and no Plan, Use, or Add to training step. Calendar views and changes the same training's dates.

Unfinished cards are grouped into Today and overdue, Upcoming, and No date. Dates determine ordering; a program is one expandable card positioned by its next unfinished workout. History contains completed or ended training and completed workout results. A workout can start without a date. Repeat opens a fresh editable copy with dates cleared. Assign gives connected athletes independent copies. Deleting untouched training or ending its remaining work preserves completed results and other athletes' copies.

Weighted strength defaults remain reps and weight; RPE is optional and off for new default prescriptions. Existing explicit tracking choices and movement-specific defaults are preserved.

## Full-app review coverage

| Surface | Required alignment |
| --- | --- |
| Navigation and restoration | Training, Calendar, Exercises, Coaching; historical Next routes redirect to Training. Back restores the actual training detail. An active session remains resumable and locally recoverable. |
| Training | All created and assigned training appears once; source records with runs stay hidden even across pagination. Show dates or No date, optional date actions, direct Start/Resume, Repeat, Assign, and Delete/End. Preserve skipped-workout Restore and completed-result pagination. |
| Program details and editor | Start any unfinished workout, including an undated one. Edits target that occurrence; completed content stays frozen. No publication, template, in-use, or add-to-training choices. |
| Calendar | Select an existing standalone workout or program, then change its dates. No frequent/reusable-source picker and no implicit repeats. Date removal leaves unfinished training available without a date. |
| Coaching | Independent assigned training uses the same date vocabulary and supports changes after every workout has received a date. Coaches never receive athlete Start/Finish controls. Legacy persistence identities do not become a visible alternate workflow. |
| History and Repeat | Completed results remain immutable. Repeat copies the effective prescribed content and clears dates/results. Previous actuals remain cell hints only. |
| Recovery and concurrent actions | Existing active-session recovery, draft synchronization, offline handling, and idempotent start/completion remain intact. Removing a navigation section must not discard an active session or make another start possible. |
| Cleanup | Retire unused Next rendering, self-planning wizard steps, source-reuse Calendar hooks, obsolete action labels, and contracts that assert retired behavior. Preserve migrations and compatibility needed to read existing records. |

## Focused Calendar selector

`TrainingDatePicker` lists active own runs (including coach assignments) and own source-only training. It excludes private occurrence editors, completed/ended runs, and sources already represented by own runs. Search includes the next workout title; date-ordered rows show one training object each. It returns that object's identity to the shared date editor and performs no copy, assignment, or scheduling mutation itself.

## Additional integration fixes

- Active and historical pages are independent. Older active-page responses cannot reinsert rows after a date, completion, or removal refresh. A run-only refresh cannot discard a valid catalog refresh.
- Starting training publishes the matching session and form values together before loading its workout detail, preserving recovery without leaking the previous workout's form values.
- Expanded program cards refresh after authoritative updates even when their next date and completion counts have not changed. Stale expansion responses are ignored.
- Editing a selected source workout preserves its position when preparing an editable revision changes workout IDs. A coach's Repeat action uses the selected concrete training identity without depending on an already-open detail screen.
- Private occurrence editors stay out of the Training feed. Creation always starts in the owner's Training; athlete copies are created through Assign.
- Mobile cards keep Open, Start/Resume, and More on one row. Touch targets remain at least 44 pixels; full accessible labels are retained. Checks cover 320–768 pixel widths, menu overflow, navigation, and accessibility.
- Obsolete Next, source-reuse scheduling, and completion-banner styles were removed. Bundle limits remain unchanged.

## Verification status

Implementation and local verification are complete. The final `npm run ci:verify` gate passed: ESLint, TypeScript, the production build, **238 retained legacy tests** (one optional hosted integration skip), **773 behavior tests across 85 files**, and every existing bundle budget. Evidence: `artifacts/unified-training-final-checks.log`. The prior iteration's [test evidence](2026-09-21-training-refactor.md) remains historical.

Final bundle sizes: JavaScript 812,223 bytes raw / 227,631 gzip; CSS 118,082 bytes raw / 21,571 gzip; largest asynchronous JavaScript chunk 40,011 gzip. Budget limits were not raised.

Focused verification completed: **77 behavior tests across nine files** passed, covering assignment, optional dates, Calendar selection, coaching, history and routing. These include a regression for clearing an existing standalone workout's date without deleting or repeating it, exact run/result selection, native Back/Forward restoration, coaching pagination, Calendar source/run deduplication, assigned-training selection, search, and load failure/partial-page behavior. The coaching UI's obsolete assignment fallback was removed after verifying that migration `202609020003` backfilled assignments into concrete runs and retired the old assignment writers; database lineage remains intact for historical records.

The retained legacy suite initially passed **239 tests, with no failures and one optional hosted integration skip**. The final pass has **238 passing tests** after deleting the unused Next-list helper and its test. Twenty-two source-shape assertions for retired Next, source-reuse picker, self-planning, and previous card layouts were removed; rendered behavior tests now exercise their replacements. Historical SQL authorization, snapshot, migration, and immutable-history contracts remain. Evidence: `artifacts/unified-training-review-focused.log`, `artifacts/unified-training-legacy-review.log`, and the final gate above.

`AssignTrainingDialog` replaces the mixed self/coach planning wizard. Assignment defaults to No dates, supports optional dates and multiple athletes, and always reviews the target athletes and content before submission. The same request payload reuses its idempotency key on retry. Missing/revoked selections cannot proceed from the athlete picker. `TrainingDatesEditor` accepts empty dates as an explicit return to undated training; its actions are Save date / Save dates.

The generic assignment picker now selects concrete training copies by run identity, loads their effective edited workout tree, and submits that run identity alongside the real program ID. It hides already-used sources and private editor records, keeps same-source copies separate, and preserves both source and run pagination. Failed or stale detail requests never substitute original source content. **15 assignment behavior tests** passed, including effective workout identity, separate copies, retry isolation, hidden preselection, pagination, and idempotency keys that distinguish different copies of the same source. Targeted ESLint and the app typecheck passed.

Journey checklist used for the review (specific browser, behavior-test, and database execution evidence follows):

1. Create a workout, add Back squat, verify RPE is off, return to Training, and find one No date card without any Plan step.
2. Set a date from Training, change it from Calendar, then clear it; the same training identity returns to No date without duplicates.
3. Start the undated workout, type actuals, navigate away and reload, then resume the same session. Finish and find its results in History.
4. Repeat from History, verify blank dates/results and retained exercise targets, then edit the copy without changing history.
5. Create a multi-workout program, start an undated workout, change another date, skip/restore a workout, and end remaining work while preserving results.
6. Assign training to a local fictional athlete; verify independent content/date changes, correct coach controls, and retained athlete results.

No hosted writes, deployment, GitHub push, or local database reset were performed as part of this local review. Existing database migrations and record lineage remain where needed to preserve old workouts and results.

## Backend and concurrency evidence

Migration `202609210003_unified_training.sql` is applied to the local Docker database, bringing it to **94 migrations**. Its atomic `ensure_own_training_run` and `start_training_workout` operations materialize the program's slots once on the first date or start. Subsequent requests reuse the same own training. Starting an undated selected workout records today's date without changing other slots' dates. Already dated starts preserve the selected occurrence's date. Private edits freeze through the existing session-start transaction.

Active summaries are filtered and sorted on the server before bounded pagination: nearest unfinished date first, undated training last, then creation time and identity. Active cursors include their sort date; History uses a separate newest-first cursor. Completed history carries its own self/coach origin, so filtering does not depend on whether an older program's summary is loaded.

Verified locally:

- `run-unified-training-database-smoke.mjs`: optional dates, repeated action keys, source-draft identity mapping, arbitrary undated slot starts, rollback when another session is active, private edits, authorization, retained results, repetition, assigned origin, and dated/undated Active pagination. Its generated records are rolled back.
- `run-unified-training-api-smoke.mjs`: two separately authenticated clients concurrently ensure and start the same training; exactly one run and one session result. Only the generated local test persona is removed afterward.
- Existing workout lifecycle and optional RPE SQL smoke tests, plus the broader local Supabase integration suite, pass.
- Portable migration verification replayed all 94 migrations in an isolated database, preserved its preexisting account, and confirmed a second promotion is a no-op. Database lint found only the existing exercise-video normalization volatility warning.
- **36 focused repository behavior tests** passed after removing obsolete scheduling, assignment-summary, and rollout fallback code.

## Desktop, mobile, and history evidence

Six browser navigation, layout, and accessibility checks passed, with one expected mobile skip. Manual inspection of the local mobile preview also confirmed the compact Training cards, optional-date editor, and Coaching assignment through its review step. The manual assignment was not submitted. The preview is left open at `http://127.0.0.1:3000/?preview=mobile#/training`.

`local-training-lifecycle.spec.ts` passed on **desktop Chromium and mobile WebKit** against local Supabase. It creates a workout, adds Back squat with RPE off, sets/clears/restores dates on one occurrence, edits that occurrence independently, repeats its effective prescription, edits the repeat, starts it without a date, verifies prefilled reps/weight with no RPE field, and completes the session. Both viewports remain within their widths; the mobile date action meets the 44-pixel touch target. The test ends unfinished generated runs and archives only its generated source IDs.

`useCompletedHistory` and `useTrainingHistory` now share the typed `useLazyHistory` implementation while keeping their feature contracts. **22 history and root-workflow tests** passed, including distinct Active/History requests, lazy request coalescing, duplicate-free older pages, failed-page retries, invalidation during an in-flight request, stale account-response isolation, and ignored invalidation callbacks from a previous account. Root regressions verify that a run-only refresh cannot discard a pending catalog refresh, newly started session values replace the prior form before detail loading finishes, editing preserves the selected second workout across cloned IDs, and the generic Coaching assignment submits the selected run's effective edited workout rather than its source. Existing completed-history coverage remains intact. Targeted ESLint and the full app typecheck passed after these additions.
