# Simple workout authoring — September 21, 2026

## Changes

- Removed routine explanatory text across Training, Calendar, Exercises, creation, and assignment. Kept user-written workout/exercise notes, errors, recovery guidance, units, and meaningful assignment/deletion consequences.
- New workouts have no estimated duration. Workout details accepts an optional duration, including clearing a previously entered value. Existing explicit estimates remain intact. Historical recorded session duration is unchanged.
- Programs use a visible workout list on mobile and desktop. The selected workout has a highlighted border and an accessible selected state. The previous mobile dropdown is removed.
- Workout details uses a pencil icon with an accessible label. It is available for standalone workouts and workouts inside programs.
- Opening training shows its actions; Edit, Create, and Repeat enter the editor. The editor shows Save, while Start, Repeat, Assign, and scheduling remain in the action view. Save flushes pending changes and returns to the action view. Existing autosave/recovery protection remains.
- Exercise search also offers **Add “name” — This workout only**, including Enter from the search field. Selecting a library result uses that exercise; adding the typed name creates only a workout item snapshot, without a personal or shared library entry. Prescription editing follows either choice.
- Custom exercises begin with reps and weight, with RPE off. Their snapshots survive copying, assignment, private occurrence edits, and workout logging.

## Local data and verification

Migrations `202609210004_optional_workout_duration.sql` and `202609210005_workout_custom_exercises.sql` were applied to local Docker without resetting existing data. They preserve older saved durations and use the existing snapshot/authorization model for workout-only exercises.

- 804 behavior tests across 87 files passed after the authoring changes.
- Final `npm run ci:verify` passed lint, TypeScript, production build, 238 legacy tests (one optional hosted integration skip), all behavior tests, and unchanged bundle budgets. Evidence: `artifacts/simple-authoring-final-checks.log`.
- Optional-duration repository tests cover missing, provided, cleared, copied, and calendar/run estimates. The authoring database smoke verifies creation and set/clear/copy in a rolled-back transaction.
- Custom exercise tests cover asynchronous search, duplicate submission, failure recovery, and exact library selection. Its rolled-back database smoke covers no library insertion, authorization, frozen-history protection, prescription edits, Repeat, Assign, and prefilled logging.
- Manual mobile inspection verified the highlighted list, Save-only editor, icon-only details, combined search/create layout, and return to actions after Save.
- Four real-browser journeys passed across desktop Chromium and mobile WebKit: the existing training lifecycle and the new simplified-authoring journey on each. The new journey verifies optional duration set/clear, selected workout rows, editor/action separation, custom creation through Enter, no library insertion, default tracking fields, and retained prescriptions after reopening and reload.

The local review above made no hosted changes. The reviewed implementation was
subsequently pushed and deployed to development; see the
[September 21 rollout evidence](evidence/phase-7/dev-rollout-20260921-unified-training.md).
