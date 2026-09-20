# Local workout recording changes — 14 September 2026

New sessions initialize exact objective targets for reps, load, duration, and distance. Rep ranges, actual RPE, and heart rate remain blank. Finishing saves the retained entries directly, with no extra unrecorded-results dialog. Resuming never restores a cleared value or deleted row. The final set can be removed. Interval rounds start retained; Skip clears that round's metrics and persists an explicit zero completion marker, distinct from an unknown legacy value.

Previous actuals appear as a muted **Last: …** line inside the same input cell. Current values remain primary; focusing, clearing, or finishing cannot copy a reference into the draft. Hints work for sets, timed holds, single results, and interval metrics. Displayed weight, distance, and duration use the same conversion as the input. A stable wrapper preserves focus and partially typed numbers when history arrives asynchronously.

`get_previous_workout_values` reads only the current athlete's most recent completed session for the same workout lineage. Stable item lineage distinguishes repeated occurrences of the same exercise. Template cloning retains that identity through renames and reordering. Existing revisions are linked conservatively only when explicit ancestry and the entire ordered workout/movement structure match. Older edited clones without provable identity can have no hint; results are never guessed from titles alone.

References use a separate bounded cache, scoped by viewer and workout, for offline access. Signing out clears that viewer's references. Late responses for a different workout or account are ignored. A failed history lookup does not block logging. Cached values remain labelled with the source workout date and refresh when online.

Local migrations applied without a reset:

- `202609140001_prefill_workout_targets.sql`
- `202609140002_previous_workout_values.sql`

Isolated UI example: `http://127.0.0.1:3001/?example=previous&preview=mobile#/today`. Its sample history is separate from real athlete data. Enter local demo and start the sample workout to review it.

Regression coverage includes startup/resume, deleted final sets, interval skip round trips, field masking, zero/null distinctions, current/previous value separation, unit switching, late history arrival while typing, offline cache and account isolation, immutable repeats, conservative legacy lineage, future clones, athlete authorization, and clone video snapshots. Database smoke tests use rollback transactions. No hosted migrations, GitHub push, or deployment are part of this local change.

## Bundle budget review

The preceding deployed build (`3a1243b`, recorded in the September 10 GitHub performance artifact) contained 812,805 bytes of JavaScript, 226,505 bytes compressed, and 119,996 bytes of CSS. Its CSS budget had only four bytes of headroom. The initial new-feature build measured 820,827 / 229,016 JavaScript bytes and 121,138 CSS bytes: approximately 1% raw JavaScript growth for the read model, cache validation, and logging UI. Sample fixture strings were verified absent from production; the demo history adapter was additionally gated to development before the final measurement.

Total JavaScript limits are explicitly recalibrated to 825,000 raw / 230,000 compressed bytes, and raw CSS to 122,000. Initial-load JavaScript limits, the largest asynchronous chunk limits, compressed CSS, and runtime request/latency limits remain unchanged. This accommodates the measured new functionality without removing validation, weakening tests, or obscuring CSS solely to satisfy a byte counter.

The final production measurement is 820,165 / 228,804 JavaScript bytes and 121,138 / 21,736 CSS bytes. The new feature costs 7,360 raw / 2,299 compressed JavaScript bytes and 1,142 raw / 281 compressed CSS bytes relative to the deployed baseline. All final bundle checks pass.

Validation: typecheck and production build passed; 720 behavior tests passed; 262 legacy tests passed (one opt-in hosted integration test skipped); four desktop Chromium/mobile WebKit authoring tests passed; the prefill, previous-values, and video-clone SQL smoke tests passed. Focused previous/demo tests were rerun after the final DEV guard. The local UI was visually checked on desktop and in the 393px mobile preview, including the RPE menu and result fields.
