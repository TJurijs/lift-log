# Lift Log MVP and architecture

The canonical glossary, independent lifecycle axes, viewer-relative provenance rules, and actor/action matrix live in [PRODUCT_MODEL_AND_CAPABILITIES.md](PRODUCT_MODEL_AND_CAPABILITIES.md). This document describes the implemented service architecture; the capability contract controls how that architecture is presented and hardened.

## Product premise

Every account can create and follow its own program for free. A user can invite one or more other accounts to coach them. Coaching is a revocable permission relationship, not a permanent user role: a person may coach others while being coached themselves.

The athlete owns their training, dates, and workout history. An active coach can assign independent training, edit future workouts they assigned, and read the corresponding results. Other training and private athlete notes remain private. Coaches cannot rewrite completed or in-progress sessions.

## MVP flows

1. Sign in with Google through Supabase Auth.
2. Create a workout or finite program in Training; set dates optionally and start any unfinished workout.
3. Build workouts from one reorderable list of reusable exercise-library items.
4. Log a workout containing any mix of instructions, strength sets, cardio results, and intervals.
5. Review finished training and workout results in Training's History or Calendar; repeat into a fresh undated copy.
6. Create a personal exercise and reuse it later.
7. Invite, accept, and independently revoke coach relationships.
8. Assign independent training to connected athletes, change its upcoming dates/content, and review its results.

## Explicitly outside the MVP

- Public coach discovery or marketplace
- Payments and subscriptions
- Chat or real-time messaging
- Ratings and reviews
- Bulk changes across athletes and cohort tools
- Wearable integrations
- Nutrition tracking

## Universal program hierarchy

```text
Program
  → Program version
    → Workout sequence (stored in one internal week container)
      → Workout
        → Exercise item
          → Prescribed entries
```

Every MVP program is finite. Workouts have an explicit sequence, while athletes
choose optional calendar dates independently. A workout is one ordered
exercise list without structural groups or categories.
`program_weeks` and `workout_sections` remain single-row internal persistence
containers so existing ownership and history relationships stay stable.

## Universal workout items

Exercise identity, workout prescription, and performed results remain separate.

```text
entry_mode: none | sets | result | intervals
tracking_fields:
  reps | load | duration | distance | rounds | heart_rate | rpe
```

Examples:

- Warm-up instruction: `none`
- Back squat: `sets` with reps/load
- Push-up: `sets` with reps
- Zone 2 ride: `result` with duration/distance
- 500 m row: `result` with distance/duration
- Bike sprints: `intervals` with rounds/duration

RPE is available as an optional tracking field and is off for new default prescriptions. Existing explicit field choices remain intact. Pace is derived from distance and duration. Load, distance, and time are stored canonically and displayed in the user's preferred units. Completing the session never requires every optional field to be filled.

## Exercise library rules

- Everyone can browse the global library plus their own personal exercises.
- A coach programming for a connected athlete can use the global library and the coach's personal library.
- Selecting an exercise snapshots its name, cue, entry mode, and fields into the workout item.
- The athlete can render and log a coach's custom exercise without gaining access to the coach's entire personal library.
- Renaming or archiving a library exercise never changes published plans or historical sessions.
- Exercises are soft-archived rather than deleted.

## Implemented architecture

Frontend: a React + TypeScript Vite SPA. Hetzner serves its static files; it does not run an application API.

Services:

- Supabase Auth for Google OAuth and session management
- Supabase Postgres for durable product data
- Row Level Security for ownership and coaching permissions
- Hetzner for serving the application

The browser talks directly to Supabase with a publishable key. Row Level Security is the authorization boundary, and multi-row lifecycle changes are exposed as transactional database functions:

- `ensure_starter_program`
- `create_program_draft`
- `duplicate_program_week`
- `duplicate_program_week_times`
- `publish_program_version`
- `start_or_resume_workout`
- `complete_workout_session`
- `create_coach_invite`
- `accept_coach_invite`

The service-role/secret key is never shipped to the browser or needed by Hetzner.

Core tables:

```text
profiles
exercises
coach_invites
coach_relationships

programs
program_versions
program_phases
program_weeks
workouts
workout_sections
workout_items
prescribed_entries

scheduled_workouts
workout_sessions
session_item_logs
session_entries
coach_feedback
```

## Ownership and versioning rules

- Each training occurrence belongs to its athlete. Source content may have a different author; assignments receive independent copies.
- Published program versions are immutable.
- Editing an upcoming workout creates an isolated internal draft for that occurrence.
- Starting atomically freezes its prescribed content; publication is not a user action.
- Completed and in-progress sessions remain attached to their original program version.
- Revoking a coach takes effect immediately; already-published plans remain available to the athlete.
- Authorization is enforced by database policies, not only by hidden UI controls.

## Environment model

- Normal local development uses the hosted nonprod Supabase project; the local CLI stack remains available for isolated migration testing.
- Nonprod uses its own hosted Supabase project and `https://dev.liftlog.cc`.
- Production uses a separate hosted Supabase project and `https://app.liftlog.cc`.
- Migrations are applied to nonprod and validated there before they are explicitly applied to production.
- Supabase project refs, database passwords, OAuth clients, publishable keys, and application data are not shared between nonprod and production.
- Test identities are explicitly marked and database constraints prevent coaching invitations or relationships between real and test accounts.

## Future extension points

Future bulk changes can use the same snapshot structure without introducing another user-facing template type:

```text
Coach workout/program → independent athlete training → individual upcoming edits
```

Any future bulk workflow should preview affected athletes, preserve their individual changes, and leave historical prescriptions intact. It is outside the current product scope.
