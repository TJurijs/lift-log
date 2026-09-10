# Lift Log — independent review, 7 September 2026

The findings below describe the reviewed baseline. Follow-up fixes and verification are recorded in [the implementation report](ASTRA_IMPLEMENTATION_2026_09_07.md).

Reviewed commit: `392d0e57af0f05bd07b4ba07ed927e50eaa065c1`. The working tree was clean at the start. This is a review of the current app, with independent persistence, database, and UI passes; it does not assume the previous reviews established correctness.

**Assessment: a substantial application with good foundations, but the current build needs correctness fixes before a wider release.** Two reproduced bugs can silently corrupt workout input. Other failures sit at the boundaries between otherwise well-tested components. The visual identity is coherent; rewriting the UI or replacing the stack would not address the most urgent problems.

## Verification and limits

| Check performed now | Result |
| --- | --- |
| ESLint and TypeScript | Passed |
| Production build, including environment validation | Passed |
| Legacy suite | 205 passed, 1 intentionally skipped |
| Behavior suite | 517 passed across 59 files |
| Coverage run | Passed; 65.87% lines, 57.54% branches overall |
| Production bundle budgets | Passed |
| npm dependency audit | 0 reported vulnerabilities at review time |
| Four new focused behavior reproductions | All exposed the defects below; failing evidence preserved separately |
| Browser inspection | Local demo; desktop and 390px mobile; dashboard, programs/editor, calendar, exercises, coaching and workout preview |
| Live SQL integration and authenticated browser matrix | **Not rerun:** Docker's Linux engine remained unavailable after attempting startup |

The browser pass verified layout and navigation, including silent loss of an unsaved program title. It did not establish real-phone behavior, current hosted database state, production concurrency, or authenticated offline recovery. SQL findings are explicitly distinguished from executed reproductions. The previous review's live test results have not been counted as this review's results. No hosted data, schema, deployment, or application source was changed.

Logs are in ignored `artifacts/astra-review-*.log` / `*.json`; focused reproductions and outputs are in [artifacts/astra-review](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/artifacts/astra-review>). Those reproduction files retain their original imports and were executed from `tests/behavior/`; copy them back there to rerun during remediation. They are outside normal test discovery so the review does not silently alter the project test suite.

## Prioritized findings

P1 means fix before broader release. P2 means a concrete defect to address in the next stability work. “Reproduced” means executed locally; “source verified” means the relevant effective code paths were traced, without claiming a live database reproduction.

### F01 · P1 · Another workout's preview can overwrite the active workout

**Reproduced.** Enter notes/load in an active workout, return to Next workouts, and preview another scheduled workout. The preview resets the shared sets, result fields, RPE and note. Persistence remains attached to the original active session, so its next autosave submits the reset values.

The focused test saved a note, opened a different preview, triggered normal page-hide saving, and observed the original session's save payload change to an empty note.

Source: [app/LiftLogApp.tsx:2141](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:2141>); persistence binding at [app/LiftLogApp.tsx:1406](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:1406>).

**Repair:** give previews independent read-only data and isolate the active session's form/controller by session ID. Add the full “log → browse → preview → resume/reload” regression, checking actual saved values.

### F02 · P1 · Typing a decimal load changes its value

**Reproduced.** Typing `72.5` character by character into a kg load field produces **`725`**. Every keystroke passes through number conversion and formatting: the intermediate `72.` becomes `72`, then the final digit is appended. The same normalization design affects lb input.

Source: [lib/units.ts:28](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/lib/units.ts:28>) and [app/LiftLogApp.tsx:5938](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:5938>).

**Repair:** preserve the raw editing string; validate and convert at a defined commit boundary. Test keystrokes, decimal separators, deleting/replacing digits, and kg/lb round trips. Existing tests that provide complete numeric strings miss this failure.

### F03 · P1 · Duplicate conflicts with the database's immutable ancestry rule

**Source verified; live SQL reproduction pending.** The latest `copy_program_to_own` prefers a readable draft and inserts that draft ID as `based_on_version_id`. The still-active metadata trigger accepts only published or superseded ancestors. Duplicating an unused own program/workout, or reused content with a successor draft, therefore reaches **“Based-on program version must be immutable.”**

Source: [supabase/migrations/202609050001_copy_readable_program_versions.sql:27](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/supabase/migrations/202609050001_copy_readable_program_versions.sql:27>) and [supabase/migrations/202608240003_program_version_metadata_snapshots.sql:136](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/supabase/migrations/202608240003_program_version_metadata_snapshots.sql:136>).

**Repair:** reconcile draft copying with the ancestry contract without weakening published history. Exercise the actual SQL RPC for both unused and previously used content. Source-text assertions that the function accepts drafts do not verify compatibility with its triggers.

### F04 · P2 · Finish uses stale metadata after conflict recovery

**Reproduced at the repository boundary; SQL rejection source verified.** Another device changes the session note/RPE while this device changes a different field. Finish flushes and correctly merges the remote values, but constructs completion from the earlier React closure. The test observed the latest draft save carrying the remote note while completion carried an empty note.

SQL rejects completion metadata that differs from the confirmed draft. The cached completion payload is retained for this non-revision error, so further Finish clicks repeat the invalid request until state is reset/reloaded.

Source: [app/LiftLogApp.tsx:2206](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:2206>); database check at [supabase/migrations/202608240005_revisioned_session_drafts.sql:638](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/supabase/migrations/202608240005_revisioned_session_drafts.sql:638>).

**Repair:** return the confirmed snapshot with its revision from flush/recovery and construct completion from that exact pair. Verify a retry after remote note/RPE changes.

### F05 · P2 · Edits remain possible after Finish has submitted the snapshot

**Reproduced.** With a deferred completion response, the workout fields remain enabled. If the server has committed while the response is delayed, a user can type additional values that cannot enter the completed session. Successful completion then clears the local draft.

Source: [app/LiftLogApp.tsx:5507](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:5507>) and [app/LiftLogApp.tsx:2238](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:2238>).

**Repair:** freeze the form and competing workout actions for the complete finalization interval. Test delayed acknowledgements and failed completion so the form safely unlocks when appropriate.

### F06 · P2 · Program editing mixes automatic saves with silently discarded drafts

**Browser reproduced.** Change the program title, press Back to Programs, and reopen: the old title returns, with no warning. Title/description remain local drafts, while workout/exercise changes persist immediately. The interface says changes are saved for future uses, but different fields have different persistence rules.

Source: [app/features/programs/ProgramView.tsx:132](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/features/programs/ProgramView.tsx:132>) and [app/LiftLogApp.tsx:4524](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:4524>).

**Repair:** establish one explicit save model. Prefer consistent autosave with field-level status, or a coherent draft with Save/Discard and navigation protection. Verify browser Back, feature navigation, and editor actions while metadata is dirty.

### F07–F14 · Additional source-verified defects

| ID / priority | Trigger and impact | Source and repair direction |
| --- | --- | --- |
| F07 · P2 | Repeated Save clicks while creating an exercise send multiple fresh inserts. Editing can also issue overlapping saves. The dialog has no submitting guard. | [app/LiftLogApp.tsx:7562](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:7562>); await the callback, synchronously guard duplicate submission, reuse AsyncButton, and keep errors in the dialog. |
| F08 · P2 | Selecting miles in Account does not change distance logging: result and interval inputs still use km and never receive the profile preference. | [app/LiftLogApp.tsx:5998](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:5998>) and [app/LiftLogApp.tsx:6120](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:6120>); consistently convert storage/display units, including history, or remove the unsupported preference until implemented. |
| F09 · P2 | An athlete's older active plan can be hidden behind 25 newer finished/ended runs. The coach Plan view filters only the loaded page and says “No training assigned”; its directory count can also become zero. | [app/features/coaching/CoachWorkspace.tsx:736](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/features/coaching/CoachWorkspace.tsx:736>); query active plans independently or prioritize them server-side. Distinguish partial data from a definitive empty result. |
| F10 · P2 | Calendar can reschedule an earlier program workout after a later one, although the run scheduling wizard rejects that ordering. The individual mutation bypasses the shared order validator. | [supabase/migrations/202609030004_end_empty_single_workout_runs.sql:19](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/supabase/migrations/202609030004_end_empty_single_workout_runs.sql:19>); enforce the same intended rule in both write paths under the same run lock. |
| F11 · P2 | Search fields lose the visible keyboard-focus outline. A later `.search-field input { outline: 0 }` overrides the global focus-visible rule, with no replacement treatment. Computed browser styles also showed no outline/shadow. | [app/globals.css:3301](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/globals.css:3301>); add a visible focus-visible/focus-within treatment for all search fields. |
| F12 · P2 | Opening an exercise video declares a modal but leaves focus in the underlying page. The custom dialog does not move/trap/restore focus. | [app/exercise-video-link.tsx:122](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/exercise-video-link.tsx:122>); reuse the shared dialog behavior, including iframe-aware keyboard handling. |
| F13 · P2 | The custom RPE listbox has no Arrow/Home/End navigation or opening focus transfer; selecting an option unmounts the focused element. Its fixed accessible label omits the selected value. | [app/LiftLogApp.tsx:5740](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/LiftLogApp.tsx:5740>); use a native select or implement complete focus, selection and keyboard behavior. |
| F14 · P2 | Portable migrations contain one-off development cleanup tied to a real account and exact run/program IDs and counts. Another environment with that account but different data aborts migration replay. | [supabase/migrations/202609030002_remove_pre_v1_test_runs.sql:28](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/supabase/migrations/202609030002_remove_pre_v1_test_runs.sql:28>) and [supabase/migrations/202609030003_remove_pre_v1_test_programs.sql:27](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/supabase/migrations/202609030003_remove_pre_v1_test_programs.sql:27>); separate operational cleanup from schema delivery and rehearse promotion against representative existing accounts. |

The video and RPE findings concern actual keyboard usability; visual styling and ARIA attributes alone do not supply the interaction behavior. The [W3C modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) describes the expected focus containment and restoration.

### F15 · P2 · Updating the app can strand already-open pages

**Reproduced with the unchanged generated worker in a focused VM harness; full browser upgrade test pending.** A new service worker immediately activates, deletes older shell caches, and takes control of existing pages. Those pages still execute the old main bundle and may later request an old, lazily loaded feature. The new worker only handles its own asset URLs.

The proof served an old chunk with status 200 before takeover, then showed that the same URL was no longer intercepted after activation. A simulated replacement host returned 404; offline fetching failed. This requires an old page, a chunk not already in its HTTP cache, and either offline operation or hosting that no longer serves that old asset. The lazy import failure can reach the whole-app error boundary.

Source: [offline-app-shell.mjs:11](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/scripts/lib/offline-app-shell.mjs:11>). Evidence: [proof script](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/artifacts/astra-review/offline-upgrade-proof.mjs>) and [proof result](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/artifacts/astra-review/offline-upgrade-proof.json>).

**Repair:** let existing clients finish on their worker version, or coordinate activation and a safe reload while retaining old assets. Avoid forcing a reload during unsynced workout editing. Verify two build versions, an already-open active session, navigation into an unloaded feature, and offline operation. This matches the mixed-version risk described in [Google's service-worker update guidance](https://web.dev/learn/pwa/update).

## High-priority database risk requiring a concurrent reproduction

**Publication can race an already-running edit.** The common draft-tree guard checks the version's status without taking a version lock. Its effective definition at the reviewed baseline was [supabase/migrations/202608210002_test_population_and_multi_coach.sql:379](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/supabase/migrations/202608210002_test_population_and_multi_coach.sql:379>). Newer append operations do lock versions, but existing edits and authorized direct updates can still use this guard without that lock.

Expected interleaving: transaction A updates a draft workout and holds the transaction open; transaction B publishes/creates a run, reading the previous committed tree; A commits afterward. This can alter the published tree after publication and disagree with the successor draft cloned by B. This is a strong code-level concurrency concern, **not a claimed executed SQL result**.

Treat it as a release gate: reproduce with two real database connections, serialize every tree mutation against publication using a consistent lock order, and prove both interleavings. Sequential “editing a published version fails” tests do not cover an edit that started before publication.

## UI/UX and consistency assessment

The dark palette, lime primary actions, rounded panels, shared navigation, and mobile bottom navigation give the app a consistent identity. The inspected pages fit a 390px layout. Clear source/status distinctions, empty-search recovery, shared dialog primitives and responsive action wrapping are useful foundations.

The highest-value design work is practical:

1. **Make primary program actions readable on touch screens.** The mobile card presents Edit, Duplicate, Start and Delete as a row of icons. Accessible labels help assistive technology, but sighted touch users cannot rely on hover titles. Give the primary “Start/Schedule” action a visible label and put less frequent/destructive actions in a labelled menu.
2. **Increase the minimum readable type scale.** Several captions are 8–10px; desktop exercise-picker names/details are 10px/8px ([app/features/programs/program-view.css:41](</C:/Users/toyur/OneDrive/Documents/Dev Projects/lift-log/lift-log-app/app/features/programs/program-view.css:41>)). Use the existing 12–13px caption/control tokens consistently and larger body text for prescriptions and results. Verify at normal size on a phone, with a soft keyboard and enlarged text.
3. **Reduce navigation and explanatory overhead during training.** Mobile Calendar's three stacked statistics cards push the date grid and selected-day actions well down the screen. Compact these statistics and keep the selected day's next action close to the calendar.
4. **Unify terminology and saving feedback.** “Mine,” “Own,” “My exercises,” “Editable template,” program runs and training plans describe overlapping concepts. Keep the domain distinctions in the implementation, but choose stable user-facing labels for reusable content, scheduled use, and completed history.
5. **Apply the existing interaction primitives everywhere.** The shared ModalShell and SegmentedTabs already solve several keyboard problems. Custom video/RPE controls and exercise-save dialogs bypass these solutions.
6. **Make demo behavior representative.** The demo Start workout button was a visible no-op. Its no-repository branch sets flags without creating an active session, while the logger visibility depends on an active session. This is a demo-specific defect, not evidence that authenticated Start fails. It reduces the demo's usefulness for onboarding and QA.

These are design recommendations based on inspection, not findings from usability interviews or a formal accessibility certification.

## Maintainability and programming practices

| Area | Assessment |
| --- | --- |
| Stack and types | React/TypeScript/Vite/Supabase are suitable here. Strict TypeScript and lint rules provide useful guardrails. A stack rewrite is unnecessary. |
| Feature boundaries | The central app is **9,738 lines**, repository **3,834**, global CSS **5,975**, and persistence hook **1,112**. Shared root state couples preview, logger, navigation, editor dialogs and asynchronous operations. F01 is a concrete consequence of that coupling. |
| Database evolution | 79 migrations and repeated function replacements make the effective behavior difficult to see. Migration text tests cannot establish that today's combined functions, triggers and policies agree. |
| Test quality | Many genuine behavior tests cover difficult persistence/cache cases. Legacy checks also rely on regexes and function-location markers, which are brittle during refactoring and miss cross-feature behavior. |
| Coverage distribution | Overall line coverage is 65.87%, but the central app is **29.01% lines / 26.35% branches**. Repository line coverage is 81.25%. Counts alone overstate confidence in the main user flows. |
| Operations | Environment validation, separate builds, deployment headers, rollback guidance and local-only test guards are positive. The implemented telemetry sink retains a small browser-session trail and emits an event; centralized error collection/alerts are not established by this code. |

Refactor in small, behavior-preserving steps after the correctness regressions are in place:

- First isolate active workout state from previews and make completion an explicit transaction/state transition.
- Extract program authoring and its dialogs behind one save contract.
- Move coaching and scheduling data controllers out of the root, keeping query scope and mutation invalidation local to each feature.
- Split repository interfaces by feature while retaining one authoritative client/authorization boundary.
- Consolidate CSS tokens and component styles; reduce repeated overrides.
- Generate a current schema/function and RPC-permission inventory from a migrated local database. Preserve deployed migration history; use a deliberate migration repair/baseline process, not ad hoc edits to already-applied migrations.
- Replace workflow regex checks with boundary/interaction tests as features move. Keep source checks only where they protect a real architectural/security invariant.

## Performance and security assessment

The current production bundle passes its budgets: initial JS **419,649 bytes raw / 119,446 gzip**, total JS **797,589 / 223,627**, and CSS **119,979 / 21,797**. CSS has only **203 compressed bytes** below its 22,000-byte limit; total compressed JS is also close to its existing ceiling. Extracting files improves maintainability but does not automatically reduce downloaded code. Measure route dependencies and remove duplication before increasing budgets.

No new production speed or capacity figures were established. The older loopback performance measurements do not prove mobile-network latency or supported concurrent user counts.

The reviewed authorization paths show deliberate server-side access control, owner-scoped sessions, scoped coach reads, immutable-history guards, revision checks, bounded reads, parameterized calls and separated client/secret configuration. No cross-account disclosure was established in the inspected paths, and npm reported no known dependency vulnerabilities. Neither observation proves the absence of security issues. The publish/edit race and promotion hazard still need resolution, and actual backup restoration plus centralized diagnostic delivery should be demonstrated before expansion.

## Recommended order of work

1. Fix **F01–F05** with the four failing reproductions promoted into permanent regressions, plus real SQL duplication coverage.
2. Prove and resolve the concurrent publication risk; fix migration promotion, service-worker updates and scheduling consistency.
3. Fix the remaining form, unit, pagination and keyboard defects. Unify the save model before polishing visuals.
4. Run the full authenticated desktop/mobile suite and database checks once local Docker is available. Include two-device conflicts, slow responses, offline editing/reload, decimal typing, and navigating away from dirty forms.
5. Refactor feature boundaries and improve visual hierarchy incrementally, retaining the existing design identity.
