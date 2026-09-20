# Program lifecycle and deletion review — 14 September 2026

## Confirmed development case

A read-only inspection of **Balanced Weightlifting — 3 Days** found two completed workouts and one unscheduled workout. The third occurrence is still `planned`, has no calendar date, and has no session. The run therefore remains `in_progress` with 2/3 actually completed. It was not persisted as skipped. No development data was changed during this review.

This state is consistent with removing a calendar date. It is not proof of which UI action the user took. The interface should make its consequence clearer and make stopping an unfinished plan easy to discover.

An actual skipped slot is terminal: the existing SQL closes a run once every slot is completed, skipped, or cancelled. A run with two completed workouts and one skipped workout already moves into History, where the UI calls it “Closed.” Its actual completion count correctly remains 2/3.

## Recommended actions

| Action | User meaning | Effect on saved training |
| --- | --- | --- |
| Remove date | I will schedule this workout later | Clears the calendar date; keeps the workout unfinished in this plan |
| Skip workout | I will not do this workout in this plan | Records a skip; can be restored; does not invent a completed session |
| End this plan | I am finished with this attempt at the program | Cancels remaining workouts and moves the run into History |
| Archive template | I no longer want this reusable program in my library | Hides the template; retains all existing plans, dates, and results |

Do not make a single Delete action span reusable content, one person's current plan, and their completed training history. These have different owners and different consequences.

## UI changes worth implementing

1. Rename **Remove from calendar** to **Remove date**, with “This workout stays unfinished in your plan.” Show **Skip workout** next to it, including for an undated workout.
2. Replace a bare 2/3 indicator with **2 completed · 1 needs scheduling**. Once skipped, show **Finished · 2 completed · 1 skipped**. Use completed work for the progress count and a separate lifecycle label for whether there is anything left to do.
3. Put **End this plan** in the active plan's menu and expose it from the reusable program's **View active plan** area. Confirm with a concrete count: “End this plan and cancel 1 remaining workout? Your 2 completed workouts will stay in History.” Do not require users to delete the template to leave an active plan.
4. Rename the reusable program's current **Delete** action to **Archive template**. The backend already archives rather than erasing history. Allow archiving an owned template while runs exist; retain those runs' links to immutable content. Add an Archived view with Restore if recovery is offered in the UI; the current implementation should not be described as restorable until that path exists.
5. Keep the same action names and icons across desktop and mobile. Mobile can put them in one contextual menu rather than adding permanent buttons to every card. Show the progress explanation on the card without requiring that menu to be opened.

## Own plans and coach-assigned plans

Athletes may stop their own or assigned plans while retaining their results. Coaches may end assignments they created while their access is active. That affects only the selected athlete's plan. Archiving a coach's reusable template must not silently end any athlete's plan. An explicit separate bulk action, with the affected athletes and unfinished workouts listed, would be needed to end several assignments.

Completed results remain athlete-owned records. Ending, unassigning, or archiving must not delete them or recalculate them as though skipped work was performed. Permanent deletion of completed sessions would be a separate athlete action, outside the scope of removing a program.

If a workout is currently in progress, resolve it before ending its plan, matching the current server guard. Preserve repeat as “start a fresh plan,” leaving the prior run and its history intact.

## Current implementation references

- `supabase/migrations/202609020003_program_runs.sql`: `private.refresh_program_run_state` and `public.end_program_run` implement terminal slot status and history-preserving termination.
- `lib/program-progress.ts`: `programRunLifecycleLabel` distinguishes Completed, Closed, and Ended.
- `app/features/program-runs/SelfProgramRuns.tsx`: completed and ended runs are grouped under History.
- `app/features/program-runs/ProgramRunCompactCard.tsx`: an End action already exists in the active plan menu.
- `app/features/programs/ProgramsHome.tsx`: active runs suppress reusable template Edit/Delete controls and show a View active plan link.
- `app/LiftLogApp.tsx`: current deletion dialogs distinguish ending a run, unassigning, and removing reusable content; the latter explicitly preserves existing training plans and results.

## Recommended next scope

Prioritize the date/skip wording, unfinished-work breakdown, and accessible End action. For the reported run, explicitly skipping its final workout would close it with the honest summary **2 completed · 1 skipped**. Archiving the reusable template is a separate choice and is not needed to resolve the active plan.

This document is a recommendation, not an implemented lifecycle change. No run, template, assignment, or completed result was changed.
