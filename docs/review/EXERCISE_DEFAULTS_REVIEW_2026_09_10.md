# Exercise defaults and recording review — 10 September 2026

## Recommendation

Use one visible **Record** configuration for an exercise, such as **Reps**,
**Reps + weight**, **Time**, **Distance + time**, or **Instructions only**.
Hide optional weight, RPE and heart rate behind Customize. The library should
provide sensible defaults, with workout-specific overrides when needed.

Keep **planned targets** and **actual results** as separate data. They should use
the same metric definitions, but a target is not proof that an athlete performed
it. Actual values should start blank and be entered or explicitly confirmed.

This is a read-only review of the development release
`701f897cb9e93e269790e79fd4ef4590e6408d2d`, the live development database, and the
current source. No exercise, workout, session, deployment or application code was
changed. The audit covered all 715 active shared catalog rows and the defaults of
6 active personal exercises. Catalog screening identifies candidates; unfamiliar
variations need their source description checked before changing their metrics.

## What the app does now

1. An exercise stores `default_entry_mode` and `default_tracking_fields`.
2. Adding it to a workout copies those defaults into a workout item, with its
   own prescription. That copy can be customized independently.
3. Starting a session makes another snapshot for logging and history.

There are not two independently configurable lists of “logged” and “recorded”
fields. The overlapping UI controls are **Format** and **Track during workout**:
the former selects a layout, the latter selects metrics in that layout. The
library repeats labels such as Repetitions + Reps or Duration + Duration.

Sources: [domain types and defaults](../../lib/domain.ts),
[exercise editor](../../app/features/authoring/ExerciseModal.tsx),
[tracking selector](../../app/features/authoring/FormatTrackingFields.tsx),
[library display](../../app/features/exercises/ExercisesHome.tsx).

## Findings in priority order

### P1 — Targets can become recorded results without confirmation

The session-start SQL copies prescribed reps, load, duration, distance and rounds
directly into `session_entries`. The repository reads those as actual logs;
nonzero interval rounds are interpreted as completed. Missing session RPE is
also displayed as 7.

A completely untouched hosted session remains at revision 0, so Finish currently
fails the server's revision check. After an unrelated edit such as a session
note, the confirmed draft can save the prefilled exercise values as actual
results. Completion validates revision and session metadata, but does not check
that those exercise results were entered or confirmed.

This is a verified code-path problem, not a claim that a particular person's
existing workout was falsely recorded. The data lacks the provenance needed to
determine that retrospectively.

**Fix:** start actuals blank; show targets as non-saving hints. Offer explicit
“Complete as planned” or “Use target” when convenient. Unentered RPE stays blank.
Completion should clearly handle exercises that remain unrecorded.

Sources: [session creation SQL, lines 1257–1266](../../supabase/migrations/202608290001_v1_performance_data_architecture.sql),
[active session parser, lines 1374 and 1437](../../lib/repository.ts),
[completion validation, lines 578–659](../../supabase/migrations/202608240005_revisioned_session_drafts.sql),
[finish flow, line 1890](../../app/LiftLogApp.tsx).

### P1 — Generic numerical defaults are inappropriate

Every newly added duration-tracked result gets a **1,200-second / 20-minute**
target. This includes Plank even though its catalog field type is correct.
Repetition exercises get **3 × 8** and target RPE **7–8** regardless of the
movement, including when the selected metrics omit RPE.

**Fix:** separate metric defaults from prescription quantities. New quantity
targets should be blank unless an intentional template supplies them. Do not
replace the universal 20 minutes with another universal training dose.

Sources: [authoritative append RPC, lines 179–193](../../supabase/migrations/202609070001_serialize_program_content_publication.sql),
[demo append behavior, line 2095](../../app/LiftLogApp.tsx).

### P1/P2 — Catalog rules misclassify movements

The imported catalog uses broad name/category rules. Examples include a match
for `dip` removing load from Dip Clean and Dip Snatch, `sled` matching
Sledgehammer Wrist Rotation, and `plank` making moving plank variations timed.
Some section-based rules remove weight from explicitly loaded core movements.

| Exercise/example | Live shared default | Recommended default |
| --- | --- | --- |
| Step-up | Reps + load + RPE | Reps; added weight optional |
| Plank, Side plank | Duration + RPE | Time; RPE optional; no reps |
| Wall Sit | Duration + load + RPE | Time; added weight optional |
| Dip Clean / Dip Snatch | Reps + RPE | Reps + weight; RPE optional |
| Sledgehammer Wrist Rotation | Distance + load + RPE | Reps + weight; RPE optional |
| Dynamic plank variations | Mostly duration | Review movement-specific reps/time defaults |
| Personal “Cooldown” | Reps + load + RPE | Review as instructions or time |

The specific shared entry is named **Step-up**; no separate active exercise named
Box Step-up was found. Some existing draft/published Step-up workout entries
already override the shared default to reps + RPE, so re-adding it would bring
load back. Existing Side plank entries use intervals, which can be an intentional
choice and should not be overwritten just because the catalog says duration.

**Fix:** review explicit exercise identities and supported variants. Keep default
weight off for ordinary bodyweight step-ups as requested, while allowing a
weighted variation. Do not disable load on every step-up or treat every movement
containing “hold” or “plank” as identical. Replace broad runtime/import guesses
with a reviewed, versioned default registry and semantic regression examples.

The completed catalog inventory contains **58 source-backed correction
recommendations**, **8 step-up/down default preferences**, **14 bodyweight
consistency recommendations**, and **4 optional changes** where reps and time
can both be valid. Another **10 cases** are deferred for variant/source/product
decisions. All 715 entries were screened; 150 primary source pages were retrieved
for candidates and comparisons, rather than claiming independent source
verification of every exercise.

See the [full exercise-by-exercise inventory](EXERCISE_CATALOG_DEFAULTS_2026_09_10.md)
and [exact-ID/current/recommended data](EXERCISE_CATALOG_DEFAULTS_2026_09_10.json).
The inventory retains existing RPE selections while correcting movement metrics;
the proposed simpler optional-RPE interface is a separate product decision.

Primary examples: [Dip Clean](https://www.catalystathletics.com/exercise/371/Dip-Clean/),
[Sledgehammer Wrist Rotation](https://www.catalystathletics.com/exercise/787/Sledgehammer-Wrist-Rotation/),
[Copenhagen Plank Lift](https://www.catalystathletics.com/exercise/566/Copenhagen-Plank-Lift/).
The current rule implementation is in the
[format migration](../../supabase/migrations/202608300012_format_driven_exercise_tracking.sql).

### P2 — Timed sets and units are unnecessarily awkward

“Duration” becomes a single-result layout. The sets layout only supports reps,
load and RPE. A simple **3 × 30-second plank** therefore needs the interval
workaround. Timed targets, inputs and history use minutes, displaying 30 seconds
as 0.5 min.

**Fix:** allow repeated entries independently of which metric is recorded. A
set can contain reps, time or distance. Display short durations in seconds or
minutes:seconds. Keep interval work/rest settings as optional structure.

Sources: [mode compatibility, lines 62–67 and 127–130](../../lib/domain.ts),
[logging, history and authoring at lines 5291, 5576 and 6698](../../app/LiftLogApp.tsx).

### P2 — Default normalization has two conflicting paths

Format defaults for repetitions are reps + RPE. Older mode defaults are reps +
load + RPE. An empty/incompatible selection can fall back to that broader set.
Conversely, a result with only load + RPE is accepted by the repository but
labeled Duration; opening its editor introduces duration as a required field.

**Fix:** use one canonical validated configuration across the importer, library,
editor, repository, logger and history. Editing an exercise should not silently
add a metric, and invalid input should not restore broad defaults unnoticed.

Sources: [normalizers, lines 52–80 and 156–166](../../lib/domain.ts),
[editor initialization, line 35](../../app/features/authoring/ExerciseModal.tsx).

## Proposed product behavior

- **Exercise library:** one summary, e.g. “Record: Reps + weight”. No duplicate
  Format/Tracking badges. RPE and heart rate are optional, not universal fields.
  Currently 709 of 715 shared exercises enable RPE by default.
- **Workout planning:** the same metrics, optional targets, and a straightforward
  number of sets/entries. Rest and interval timing are plan structure.
- **During the workout:** only the chosen actual-value inputs, with separate
  target hints and explicit confirmation shortcuts.
- **History:** show saved actuals and the original snapshot. Keep missing distinct
  from zero, and preserve metric units and any historical configuration.

## Implementation order and validation

1. Correct session initialization/confirmation and empty RPE handling, so defaults
   cannot silently become actual results.
2. Remove universal numerical prescriptions and unify default normalization.
3. Apply the reviewed catalog corrections using explicit IDs and guarded expected
   current values. Catalog changes affect newly added exercise entries.
4. Consolidate the field UI, add timed sets, and improve duration units.
5. Review existing draft overrides separately. Do not bulk-rewrite published
   versions, in-progress sessions or completed history.

Twenty-nine existing focused tests passed across logging formats, repository
exercise defaults, prescription payloads, session payloads and completed detail.
They validate the present mechanics, not the semantic correctness of the catalog
or actual-value confirmation. Add regression coverage for representative exercise
families, blank actuals, unrelated-note edits, explicit “as planned” confirmation,
timed sets and unit round trips when implementing the fixes.

The live read-only aggregate check found no non-null session metrics outside
their saved `tracking_fields`. That is useful but does not establish that saved
values were manually entered. Detailed read-only exports and test output are in
the ignored `artifacts/exercise-review/` directory.
