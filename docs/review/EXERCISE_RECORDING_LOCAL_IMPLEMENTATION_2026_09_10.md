# Exercise recording — local implementation, 10 September 2026

Status: implemented and applied locally for review. Nothing has been pushed or deployed from this change set.

## Behavior

- Exercise defaults and workout targets share one **Record** configuration: Reps, Reps + weight, Time, Distance + time, Rounds + time, or Instructions only. Compatible optional fields are available under Customize.
- Library cards and exercise details display one recording summary. Exercise filters recognize time and distance in both single results and repeated sets.
- Planned targets remain separate from actual results. Starting a new session creates empty result values; missing session RPE stays empty. Existing session values and historical snapshots are preserved.
- **Use targets** explicitly fills empty results from exact numeric targets. It preserves values already entered, leaves rep ranges for manual entry, and never copies planned RPE into reported effort.
- Finishing with unrecorded primary results asks the athlete to keep logging or finish with those values blank. The initial empty draft is saved before completion, preserving the server revision contract.
- Timed and distance sets work independently of repetitions. A plank can be prescribed as 3 × 30 seconds, with seconds displayed in its inputs and history. Single time results support seconds/minutes selection. Storage continues to use canonical minutes, kilometres and kilograms.
- Adding an exercise no longer invents rep, weight, RPE or duration targets. Repetition exercises retain three empty set rows; other recorded formats start with one empty entry.

## Catalog and database

Applied local migrations `202609100001_explicit_workout_recording` and `202609100002_reviewed_exercise_catalog_defaults`.

The registry corrects 84 reviewed shared exercise defaults, including reps-only ordinary step-ups and movement-specific corrections for loaded or dynamic variants. Existing RPE preferences are retained where present; users can remove them through Customize. The 10 deferred catalog cases remain unchanged. Personal exercise defaults and existing workout/session snapshots are not rewritten.

Catalog matching uses stable source identities plus expected names, URLs and prior fields. Unexpected identity/default drift aborts the migration. Reapplying it is safe. The audit UUIDs remain provenance, rather than assuming generated import UUIDs match across databases.

SQL checks now validate the selected metrics and prescription shape, including repeated time/distance entries, while rejecting hidden unsupported values. Recording serializers preserve zero versus missing values and mask fields against the captured workout configuration.

## Local preview

- Desktop example: <http://127.0.0.1:3001/?example=recording>
- Mobile example: <http://127.0.0.1:3001/?example=recording&preview=mobile>
- Local database app: <http://127.0.0.1:3000/>

The example is an isolated, in-memory demo of Plank, Step-up, Power clean + push jerk, Back squat and Rowing. Enter the local demo and start **Strength + core**. Reloading resets the example. It uses the same authoring and recording UI as the connected app.

## Verification

- All 636 behavior tests passed, including timed authoring, single-set editing, blank actuals, target copying, units, draft persistence and reload handling. The final authoring cleanup also passed its 13 focused tests.
- All 262 legacy checks passed (one integration-only check skipped). TypeScript and the production build passed.
- ESLint passed.
- Existing bundle budgets passed: total JavaScript 808,100 raw / 224,993 gzip bytes, largest asynchronous JavaScript 44,692 gzip bytes, CSS 119,695 raw / 21,392 gzip bytes. The total gzip budget has very little spare capacity; rerun it against the exact release build before publishing.
- Successful and ambiguous saves reconcile server-normalized values, including fractional seconds rounded to whole seconds, without overwriting newer local edits. Regression tests verify the same-revision hard-reload path and retained zero prescription targets.
- Local database integration, authoring smoke and recording smoke checks passed after applying the migrations. Rollback-only catalog checks verified the 84 changes, unchanged unrelated rows/snapshots, idempotency and identity-drift protection.
- Visually checked desktop and 393px mobile layouts. Entering 25 seconds for plank set 1 and selecting Use targets retained 25 and filled sets 2–3 with 30. Completion warned about 7 unrecorded entries; saved history showed 25/30/30 seconds and blank unentered exercise values/RPE.

See the original [review](EXERCISE_DEFAULTS_REVIEW_2026_09_10.md) and [catalog inventory](EXERCISE_CATALOG_DEFAULTS_2026_09_10.md) for the scope and deferred decisions.

## Workout instructions follow-up

- The checkboxes beside plank rounds are interval-completion controls. The earlier hosted audit found Side plank configured as intervals in a saved workout. The local example uses timed sets, which require no round-completion checkbox. Explicitly changing Rounds + time to Time now preserves the count, per-round hold durations, rest and effort targets. Existing published workouts and session history are not automatically rewritten.
- Workout instructions now use the full card width, a larger font and preserved line breaks on desktop and mobile. Both the exercise cue and workout-specific notes are shown; the mobile two-line clamp is removed. Legacy free-text instructions no longer appear as numeric reps.
- Local migration `202609100003_preserve_session_exercise_instructions` preserves both sources of instructions when starting a new session. Identical notes are included once; differing prescribed-row notes retain their set/round association. Resuming and viewing existing sessions preserves their snapshots. This is the 87th applied local migration; no hosted migration was applied.
- The user identified the hosted item as Push jerk, with MAIN COMPLEX B instructions for four complexes of two power cleans followed by one push jerk, RPE 6–7, and 2–3 minutes rest. The local example now presents this as a reusable custom **Power clean + push jerk** exercise with four sets and all of that guidance. The four additional jerks are explicitly distinguished from the earlier four standalone jerks. The hosted workout itself has not been edited.
- The current logger records total reps and shared weight: a complete 2+1 set is three reps. Individual movement counts are instructions, not structured component results. A component-aware complex builder/logger remains future work. Entering `2+1` into the numeric reps target now produces guidance to use Coaching notes instead of silently dropping the target.
- The similarly named catalog [Power Clean – Power Jerk](https://www.catalystathletics.com/exercise/693/Power-Clean-Power-Jerk/) is a single hybrid movement, so it is not substituted for this sequence. The [source programming guide](https://www.catalystathletics.com/olympic-weightlifting-workouts/help/) explains component notation such as 2+1 and total-rep logging.

Final follow-up verification: 653 behavior tests and 262 legacy checks passed (one integration-only skip), along with TypeScript, ESLint, production build, local recording SQL smoke and seven registry/portable checks. Notes-only interval editing also retains configured duration/distance targets, including zero and mixed units. Desktop and 393px mobile previews were checked with the full four-complex instructions.

The existing bundle limits pass: total JavaScript 807,981 raw / 224,583 gzip bytes, largest asynchronous JavaScript 44,702 gzip bytes, CSS 119,788 raw / 21,411 gzip bytes. Program management lists and their history icon now share the existing lazy program-authoring chunk, reducing separate requests and compressed overhead; the initial loading boundary is retained. No budget was increased.

Logs are in `artifacts/exercise-review/instructions-*.log` and `instructions-bundle.json`. The earlier verification figures above describe the initial implementation before this follow-up.
