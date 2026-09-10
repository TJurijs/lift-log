# Lift Log: internal UI consistency

Reviewed 7 September 2026 against the current working tree after the stability implementation.

Implemented 9 September 2026; see `ASTRA_UI_IMPLEMENTATION_2026_09_09.md` for the completed changes and validation. The findings below retain the original review snapshot.

## Recommendation

Use one vocabulary for objects and actions, with a documented desktop pattern set and a documented mobile pattern set. Each layout should be predictable as the user moves between features. Sidebar versus bottom navigation, a desktop list beside its detail versus a mobile detail page, and different information density are reasonable adaptations.

Keep the current five main destinations for this pass. The evidence supports improving their internal consistency before considering a new information architecture. This is a design and source review, supported by the existing desktop/mobile screenshots; it is not a usability study or an implementation of the changes below.

## Concrete findings

| Priority | Current inconsistency | Recommended rule | Evidence |
| --- | --- | --- | --- |
| First | The same `Clear` control preserves search text in Exercises but clears it in Programs. | `Clear filters` changes filters only. `Clear search and filters` explicitly changes both. Apply this within desktop and within mobile. | `ExercisesHome.tsx:164,236`; `ProgramsHome.tsx:231,357`. |
| First | Program setup uses `Start` and can end with `Start workout`, while the Next workouts screen uses `Start workout` to begin logging. These are materially different operations. | Use `Use program` / `Use workout` for creating a training plan from reusable content; `Schedule` for choosing dates; `Start workout` / `Resume workout` for logging. Keep assignment as a separate named action. | `ProgramsHome.tsx:110`; `ProgramView.tsx:378`; `ProgramRunWizard.tsx:341`; `NextWorkoutsView.tsx:210`. |
| First | Navigation calls Programs a dumbbell; program cards and the editor use layers. An active program uses layers but its history row uses a dumbbell. Quick workouts also lose their distinct icon in history. | Keep the object icon through its lifecycle. Show lifecycle in the status label, not by replacing the object icon. | `LiftLogApp.tsx:194`; `ProgramsHome.tsx:299`; `ProgramView.tsx:335`; `ProgramRunCompactCard.tsx:69`; `SelfProgramRuns.tsx:127`; `CoachWorkspace.tsx:869`. |
| First | A live program editor displays `Save` while reporting that changes are saved automatically. The button currently flushes the same autosave controller. | Keep an explicit persistence model per editing context: autosaved pages display `Saving…`, `Saved`, or `Couldn't save` with retry; staged forms use `Save changes` and `Cancel`. Do not imply that a second save is required. | `ProgramView.tsx:292,486`; `LiftLogApp.tsx:4086`; `ExerciseModal.tsx:152`. |
| Next | Back to the same main destination can read `Next` or `Next workouts` within one viewport. Completed detail is titled both `Workout log` and `Workout results`. | Resolve destination names through one navigation definition, including any approved compact label. Use `Workout results` for completed detail and `History` for its collection. | `LiftLogApp.tsx:193,4059,5685,5696,5701`. |
| Next | Programs have labeled primary actions and `More`; exercise catalog rows expose copy/edit/delete icons; workout previews expose separate reschedule/remove icons. The places to look for secondary object actions vary by feature. | Define a collection-row action pattern per platform. Keep one frequent action visible and put secondary/destructive object actions in a consistently placed `More` menu. Inline editing can retain dedicated edit controls as a separate documented pattern. | `ProgramActionMenu.tsx:30`; `ExercisesHome.tsx:329`; `LiftLogApp.tsx:4986`. |
| Next | Ending an active program uses a trash icon, although the confirmation explains that completed results remain and the program can be repeated. | Reserve trash for deletion. Use a stop/end symbol plus `End program` / `End workout` for ending training. Keep `Remove`, `Unassign`, and `Delete` distinct when their effects differ. | `ProgramRunCompactCard.tsx:100`; `LiftLogApp.tsx:6367`. |
| Next | The Coaching `My athletes` tab changes its name to `Refreshing…` during refresh. A destination temporarily becomes an operation. | Keep navigation labels stable; show loading next to the label or inside its panel. | `LiftLogApp.tsx:5966,6033`. |
| Next | Mobile program/workout details use the shared sticky detail header; athlete details have their own inline Back control and separate identity card. | Define one mobile detail-header pattern, with a destination-specific Back label, object title and optional primary action. Keep the richer athlete identity card beneath it. Desktop can retain the directory beside athlete detail. | `ui-primitives.tsx:156`; `CoachWorkspace.tsx:598,631`; `globals.css:4235,5569`. |
| Next | Desktop Coaching creates no detail-history entry when selecting an athlete, but creates/updates one when selecting Plan or History. Browser Back therefore depends on which control was used after selection. | Define one desktop location rule: record athlete selection as the detail context and update its tab within that context. Verify Back/Forward and return from a program/result against that rule. The mobile rule can remain distinct and explicit. | `CoachWorkspace.tsx:263,274`; `lib/app-route.ts`. |
| Next | Coach history calls terminal runs `Finished`; the shared formatter distinguishes `Completed` from `Closed` when some workouts were skipped/cancelled. Calendar also calls a dated occurrence `Planned` in its agenda and `Scheduled` in its legend. | Use the existing lifecycle formatter everywhere. Use `Scheduled` for a dated future occurrence; preserve separate terms for completed, skipped and ended states. | `CoachWorkspace.tsx:873`; `lib/program-progress.ts:95`; `ProgramView.tsx:181`; `CalendarView.tsx:283,309`. |
| Next | Delete confirmation refers to `Mine`, although the destination is now `My training`. A standalone `Workout` becomes `Quick workout` in the creation toast and calendar picker. | Resolve destination and object names through the same registry in menus, dialogs, feedback and empty states. Use `standalone workout` only where explaining its distinction from a program is useful. | `LiftLogApp.tsx:3073,6385,7848`; `ProgramsHome.tsx:300,315`. |
| Polish | New exercise opens a Create dialog whose submit action says `Save exercise`; a new program submits with `Create program`. Active program cards open from their title, while past programs require a separate `View` button. | Use `New…` to open creation, `Create <object>` to commit, and `Save changes` to edit. Make the identity area the consistent open target for both active and past objects. | `ExerciseModal.tsx:60,152`; `ProgramModal.tsx`; `ProgramRunCompactCard.tsx:59`; `SelfProgramRuns.tsx:125`; `CoachWorkspace.tsx:866`. |

Except for explicit `lib/` paths, paths in the evidence column are beneath `app/`; feature filenames are in their corresponding `app/features/` directory. Line numbers refer to this review snapshot.

These findings differ in strength: the Clear behavior is a concrete functional mismatch; action naming and lifecycle icon changes are clear semantic mismatches; consolidating menus and header composition are design recommendations that should be tested with representative tasks.

Two further polish opportunities follow the same rules: give editable program and workout titles a consistent visible edit affordance (`ProgramView.tsx:338,592`), and label the active-plan link explicitly, such as `View active plan`, instead of making a compact status-looking badge carry the navigation action (`ProgramsHome.tsx:96`).

## Object and action vocabulary

The existing Lucide icon set is sufficient. A small semantic registry should select the icons and wording; individual features should not choose them independently.

| Meaning | Proposed representation |
| --- | --- |
| Program / reusable multi-workout template | `Layers3`; retain the icon when showing an active or past use of that program. |
| Workout / reusable single session | `Activity`; distinguish reusable, scheduled and completed instances through explicit labels/status. |
| Exercise collection | `BookOpen` for the collection; retain the existing category marks on individual exercises. Category marks are metadata, not competing navigation icons. |
| Calendar | `CalendarDays`. |
| Coaching | `Users`; individual people keep their avatars. |
| History collection | `History`; completed state may use a check. |
| Schedule / reschedule | `CalendarPlus` / `CalendarClock`, always with an action-specific accessible name. |
| Edit / duplicate / delete | `Pencil` / `Copy` / `Trash2`. |
| End active training | `CircleStop`, with an explicit label. |
| Additional actions | `MoreHorizontal`, with `More actions for <object>` as its accessible name. |

Generic symbols such as a check or plus can legitimately appear in several contexts when their labels make the meaning clear. Do not impose a mechanical one-symbol-one-use restriction. Also retain truthful distinctions between source, ownership, permissions and lifecycle; these must not collapse into a single vaguely named badge.

## Desktop conventions

- The sidebar keeps the same destination order, names and selected-state treatment on every feature screen.
- Page headers follow one title/description/action arrangement. Object details have a predictable parent/back area; a persistent list can remain visible beside its selected detail.
- Collection rows use a consistent identity/open area, metadata/status area and action area. Text and keyboard focus communicate the open target. Selection within a persistent list remains distinguishable from navigation to another page.
- Secondary object actions have a consistent menu position. Frequently used editor controls may remain directly available, using the same edit/remove vocabulary throughout editors.
- Forms share label placement, required/optional treatment, action alignment, validation and save feedback. Additional desktop columns do not change the meaning of those controls.

## Mobile conventions

- Top-level screens retain the same bottom navigation, compact labels and account access pattern.
- Detail screens use the same Back/title/action header pattern, with the return destination preserved. A coaching detail can occupy its own screen even when the desktop keeps the athlete list visible.
- Collection rows use a clear open target, consistent trailing disclosure treatment for navigation, and a consistently placed object menu. Essential actions never depend on a tooltip or hover.
- Use a consistent touch target minimum and input sizing. Keep the primary action location stable within each task type rather than placing every unrelated action in one universal toolbar.
- Dialog forms use the same Cancel/commit order and clear save feedback. Reordering has a visible entry and exit; drag can be an enhancement alongside accessible move controls.

## Implementation path

1. **Define semantics.** Add small typed definitions for destinations, object kinds, actions and visible states. Centralize stable names and icon choices. Preserve distinct identities for reusable content, a concrete use of that content, a scheduled occurrence, an active session and completed results. Keep existing route identities, capabilities, provenance and data models intact.
2. **Fix the concrete mismatches.** Correct Clear behavior, distinguish setup from logging, preserve object icons through history, stabilize navigation labels and clarify autosave. These changes should land together with the relevant behavior checks where meaning changes.
3. **Extend the existing components.** Reuse `PageHeader`, `DetailNavigation`, `SegmentedTabs`, `SourceTag`, `StatusBadge`, `AsyncButton`, `ModalShell` and the existing object-menu pattern. Add narrowly scoped collection-row and save-status conventions. Keep domain logic in the existing feature controllers.
4. **Apply patterns by task family.** Review desktop collections against other desktop collections, then desktop details/editors; repeat independently for mobile. This avoids treating every breakpoint difference as a defect.
5. **Verify representative journeys.** At narrow mobile and desktop widths, check finding/opening an object, returning to its filtered list, creating/editing, using a program, scheduling, logging/resuming/completing a workout and reviewing an athlete. Verify Back, focus and drafts survive these transitions. Include the intermediate tablet widths so the two pattern sets meet cleanly.

Preserve the recently added save guards, stale-request protection, draft persistence and history restoration. A navigation-framework rewrite is unnecessary for this consistency pass. Any later route refactor should be assessed independently. Existing production bundle and CSS budgets have little headroom, so prefer consolidating existing styles and primitives over introducing another UI library.

## Basis and review limits

W3C guidance supports consistent identification of repeated functions and stable relative ordering of repeated navigation. It permits context-specific labels and symbols when functions differ. These recommendations apply that principle to Lift Log; they are not a claim that every visual variation is a WCAG failure. Sources: [Consistent Identification](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification) and [Consistent Navigation](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation).

Source inspection covered navigation, shared primitives, Programs/editor, exercise catalog and forms, Next workouts, Calendar, active/completed workout detail, and Coaching. Existing 390px and 1440px screenshots were inspected directly; the existing 320px screenshots remain available for follow-up validation. No new app code was changed or deployed for this assessment, and no new usability-test results are claimed.
