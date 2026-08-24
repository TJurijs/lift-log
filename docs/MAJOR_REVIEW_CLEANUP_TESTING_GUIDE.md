# Lift Log major review, cleanup, and testing guide

## How to use this document

Give this entire document to a new coding agent with access to the repository. It is intentionally self-contained and is the assignment, not merely background reading.

The goal is a stabilization pass before new feature work: measure the current application, protect its intended behavior with real tests, resolve internal inconsistencies, improve scalability, and refactor toward reusable mobile-first components. Do not perform a visual redesign or add unrelated features.

---

## Assignment for the reviewing agent

You are taking over a working but heavily iterated application called **Lift Log**. Perform a major evidence-led code review, cleanup, refactor, and testing pass. Work persistently through the phases below. First establish facts and behavioral safety; then make small, reviewable changes. Do not do a big-bang rewrite.

Repository root:

```text
C:\Users\toyur\OneDrive\Documents\Dev Projects\lift-log\lift-log-app
```

At the time this guide was prepared, `main` was clean at commit `661817e` (`Refine workout logging and exercise library`). Verify the current branch, commit, and worktree yourself rather than assuming they are unchanged.

### Mission, in priority order

1. Make initial loading, navigation, workout logging, and coach views scale to thousands of users, coaches with many athletes, and accounts with hundreds of programs and years of history.
2. Clean up and split code accumulated through rapid iterative development without changing intended behavior.
3. Establish reusable domain and UI elements so the same object, state, and action is represented consistently everywhere.
4. Make visual behavior consistent across desktop and mobile.
5. Make program, workout, schedule, session, ownership, authorship, coaching, lifecycle, and permissions logically coherent.
6. Treat mobile as the primary experience, including touch, small screens, unreliable networks, safe areas, browser navigation, accessibility, and workout autosave.
7. Replace weak structural checks with a real behavioral, database, browser, accessibility, visual, and performance safety net.

### Required opening reading

Read these before changing code:

- `README.md`
- `docs/MVP_AND_ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `lib/domain.ts`
- `lib/presentation.ts`
- `app/ui-primitives.tsx`
- `app/AppEntry.tsx`
- the opening/root-controller portion of `app/LiftLogApp.tsx`
- `lib/repository.ts`, especially workspace, program, scheduling, session, and coaching loaders
- the final state of the Supabase schema after all migrations, not only the initial migrations
- all test files, with attention to whether each test executes behavior or merely searches source text

Do not assume the documentation is perfectly current. Reconcile documentation, TypeScript types, UI copy, repository behavior, final SQL functions, RLS policies, and product behavior.

---

## Current baseline facts

Treat these as known starting conditions to verify, not as changes introduced by your work.

### Stack and delivery

- React 19 + TypeScript + Vite SPA.
- Supabase Auth, Postgres, PostgREST/RPC, and RLS are the backend and authorization boundary.
- Hetzner serves only the static build.
- Hosted development and production use separate Supabase projects.
- Local Supabase exists for isolated destructive/integration testing.

### Main code hotspots

- `app/LiftLogApp.tsx`: about 9,000 lines and 296 KB. It contains the root state controller, repository orchestration, all major views, many formatting helpers, and most dialogs. It has over 100 `useState` occurrences and more than 130 raw buttons.
- `app/globals.css`: about 5,500 lines and 109 KB, with accumulated feature rules and responsive overrides.
- `lib/repository.ts`: about 2,450–2,600 lines and roughly 90 KB; one class owns nearly all reads, joins, mapping, and mutations.
- `app/ui-primitives.tsx`: only about 200 lines. Some successful primitives exist, but most interaction patterns remain local.
- `lib/domain.ts` contains useful types but mixes source, authorship, ownership, lifecycle, schedule, and view-model concerns.

### Validation baseline when this guide was written

- TypeScript and the Vite build passed.
- `npm test` reported 70 passing tests and one skipped local-Supabase integration test.
- Most UI/performance “contract” tests read source, CSS, or SQL and assert strings/regular expressions. They do not prove rendered behavior.
- Only `tests/workout-focus.test.mjs` substantially executes ordinary application logic.
- The local Supabase test is real but is one large scenario and covers only part of the repository/RPC surface.
- `npm run lint` failed with 10 errors: unused code, two synchronous state updates inside effects, accessibility issues, and two test-file lint errors.
- No React render suite, browser E2E suite, visual regression, runtime accessibility audit, coverage report, performance budget, or checked-in CI workflow exists.
- The build emitted one application JavaScript chunk around 659 KB minified / 180 KB gzip, plus about 97 KB / 18 KB gzip of CSS, and warned about the large chunk.

Record a fresh baseline before changing anything.

---

## Product model to preserve and clarify

Use these as working product invariants. If the implementation contradicts one, document the contradiction and determine whether it is a bug, stale documentation, or a product decision that genuinely needs the user.

### People and coaching

- Every account is an athlete account. “Coach” is a revocable relationship/capability, not a permanent role.
- One person may be coached and coach other people at the same time.
- The athlete owns their schedule, program instances, and completed workout history.
- An active coach may see the data explicitly permitted by the relationship and create/edit future athlete-specific programming where authorized.
- Revocation takes effect immediately for access; it must not erase already-published athlete content or completed history.
- RLS and transactional database functions are authoritative. Hidden UI controls alone are never authorization.

### Training content vocabulary

Keep these concepts separate in code and UI:

| Concept | Meaning |
| --- | --- |
| Program | Finite multi-workout training content, organized into explicit weeks. |
| Quick workout | Single-workout content using the same workout/section/item/prescription structure, without a multi-week planning UI. |
| Program version | Draft, published, or superseded content snapshot. |
| Workout | Reusable prescribed content inside a program/version. It has no athlete result by itself. |
| Scheduled workout / occurrence | A workout placed on a specific athlete calendar date with planned/in-progress/completed/skipped state. |
| Workout session | The athlete's in-progress or completed log, snapshotting what was prescribed and what was performed. |
| Availability | Whether published content is offered as a scheduling choice; it is not the same as being dated on the calendar. |
| Assignment | A coach creates an independent athlete-owned copy from coach-authored source content. |

Do not use one generic “status” to collapse publication, availability, schedule occurrence, and completion.

### Provenance, authorship, and capabilities

- **Library** content is immutable to the user. It can be scheduled directly and can be copied to Own.
- **Own** means authored by the current user, not necessarily “owned” in the database sense. Own draft content is editable; publishing and making available are separate actions.
- **Coach** means coach-authored content assigned to an athlete. The athlete cannot edit it but may copy it to Own. The authoring coach may edit an authorized athlete-specific future version; published/completed history remains immutable.
- Source/provenance (`library`, `self`, `coach`), content type (`program`, `quick_workout`), version lifecycle, scheduling availability, occurrence state, and viewer capabilities must be modeled independently.
- Derive actions such as view, copy, edit, publish, make available, schedule, assign, start, reschedule, skip, and delete through central pure capability policies. The UI should consume these policies, and handlers should guard them again.
- A coach assigning a quick workout may provide the intended initial date (the group-for-tomorrow use case). Treat this as an explicit assignment capability, then keep subsequent calendar control and copy consistent with the athlete-owned schedule model.

### Workout and logging invariants

- New workouts start with Warm up, Main work, and Cool-down.
- Main work always exists and cannot be deleted. Deleting another section must either delete its exercises with confirmation or move them to Main work.
- Exercise identity, prescription, and performed result are separate snapshots.
- `entry_mode` is `none`, `sets`, `result`, or `intervals`; tracking fields decide which inputs actually apply.
- Planned RPE and actual RPE are distinct. RPE uses whole numbers and consistent labels/colors/help.
- Weight is displayed in kg or lb according to account settings; distance is displayed in km or mi. Canonical storage must not make preference changes destructive.
- A workout completed early or late completes on its scheduled date, not automatically “today.”
- Calendar, Next workouts, and Coaching should open the same underlying workout/result presentation rather than competing duplicate screens.
- Completed results and published historical content are immutable.

---

## Safety and working rules

1. Do not add unrelated features or redesign the brand.
2. Do not mutate production or hosted user data. Use local Supabase for destructive, scale, concurrency, and RLS tests. Hosted dev may be used only with clearly safe test personas and explicit environment checks.
3. Never put service-role keys, database passwords, or persona passwords in code, logs, browser bundles, fixtures, screenshots, or commits.
4. Do not rewrite already-applied migrations to make history look cleaner. Add forward migrations; inspect the reset database to learn the final definitions.
5. Preserve user changes in a dirty worktree. Work in small, coherent commits or clearly separated patches.
6. Establish characterization tests before moving high-risk behavior.
7. Measure before optimizing. Every performance claim needs before/after evidence at realistic cardinality.
8. Do not silence lint, type, accessibility, or test failures with broad ignores.
9. Keep temporary source-contract tests until equivalent behavior tests exist, then remove or relax the structural assertions before extracting the code they pin.
10. Do not introduce a state-management, UI, or query library merely to make the architecture look modern. Add a dependency only when its value is demonstrated and its mobile/bundle cost is acceptable.
11. Pause for the user only when a real product decision changes permissions, data ownership, terminology, or behavior. Make ordinary implementation decisions autonomously and record them.

---

## Phased execution plan

### Phase 0 — freeze and measure the baseline

Before refactoring:

1. Record `git status`, branch, commit, Node/npm/Supabase versions, and environment mode.
2. Run and record:

   ```powershell
   npm ci
   npm run lint
   npx tsc --noEmit
   npm test
   npm run build:nonprod

   npm run db:start
   npm run db:reset
   npm run seed:test-population:local
   npm run test:integration
   npm run db:lint
   ```

3. Capture current bundle sizes, route/request counts, response bytes, main-thread time, and workspace-load timing.
4. Capture desktop and mobile screenshots for all primary views and representative test personas.
5. Record current console warnings/errors, loading/error/empty states, keyboard behavior, and mobile overflow.
6. Produce a short baseline report. Separate pre-existing failures from new regressions.

Acceptance: the baseline is reproducible and no sweeping source movement has begun.

### Phase 1 — define the domain and permission contract

Create and review four artifacts before consolidating UI:

1. A glossary for Program, Quick workout, Program version, Workout, Scheduled workout, Session, Assignment, Library, Own, Coach, Published, Available, and In schedule.
2. A lifecycle/state diagram separating content lifecycle, availability, occurrence state, and session state.
3. A viewer-relative provenance model separating athlete owner, author, source, and viewer.
4. A capability matrix by actor and state for view/copy/edit/publish/availability/schedule/assign/start/reschedule/skip/delete.

Check every UI action and every repository/RPC/RLS guard against this matrix.

Known contradictions to resolve or explicitly document:

- `SourceTag` copy is viewer-blind: “Coach” means different things to the athlete and the authoring coach.
- “Own” is used as if it meant database ownership, although athlete ownership and authorship differ.
- “Ready,” “Available,” and “In schedule” sometimes collapse eligibility and dated occurrences.
- Quick workouts alternate among Program, Workout, Quick workout, Session, and Plan.
- Coach visibility promised in copy/docs is broader than some coach queries, and `coach_feedback` has no current UI.
- Coach-provided initial dates for quick-workout assignments must be a documented exception rather than an accidental schedule permission.
- Tracking fields exist in the model but the logger and prescription editor infer fields from mode, causing unwanted inputs.
- Distance preference is stored but many views hardcode km.
- Calendar/coaching details are rendered under the `today` navigation state, producing misleading Back/highlight behavior.
- The overdue-selection helper and the Next-workouts rendering path do not appear to agree on what should remain visible.

Acceptance: terminology and capabilities have one source of truth, and unresolved product questions are explicitly listed rather than hidden in conditionals.

### Phase 2 — create a real safety net

Add tests in layers. Keep tests fast and deterministic.

#### Pure unit tests

Use an appropriate Vite-native runner such as Vitest for extracted:

- capability policies and state transitions;
- provenance/status presentation;
- program/workout selectors and normalization;
- date-only, timezone, DST, calendar-week, and overdue behavior;
- kg/lb and km/mi conversion;
- prescription/tracking-field mapping;
- optimistic update, rollback, and autosave queue behavior.

Aim for high branch coverage on critical extracted domain logic (about 90% is a useful target), not an artificial global JSX percentage.

#### Rendered component tests

Use React Testing Library and user-level events against repository interfaces/fakes. Cover loading, empty, success, denied, read-only, busy, retry, and error states for:

- navigation and source tabs;
- program/training-content cards and actions;
- program builder and prescription editor;
- workout preview/logging/autosave;
- calendar scheduling and detail;
- dialogs, forms, custom selects, and destructive confirmation;
- invitations, assignments, dual athlete/coach mode, and revoked access.

Run an accessibility engine such as axe against stable rendered states.

#### Database integration

Split the monolithic local Supabase integration test by domain. Cover every public repository mutation or RPC category, including builder add/delete/reorder/move, prescriptions, week copying, quick workouts, assignments, availability, draft/publish/deactivation/deletion, invite cancellation, and scheduled status changes.

Add concurrency/idempotency tests for double clicks, two tabs/devices, stale writes, assignment conflicts, relationship revocation during mutation, and partial-failure rollback. Destructive database tests must refuse any non-loopback target.

#### Browser E2E

Use Playwright against local Supabase and deterministic personas. Cover the critical journeys listed later. Use unique test users or serialize mutating persona tests so parallel runs cannot corrupt shared fixtures.

Add visual snapshots only for stable states. Review every snapshot change rather than bulk-accepting it.

Acceptance: critical behavior is protected by executable tests before the monolith and CSS are substantially rearranged.

### Phase 3 — performance and data-shape review

#### Immediate correctness risks

`supabase/config.toml` sets `max_rows = 1000`, while several growing reads are unbounded. Test 999, 1,000, 1,001, and 5,000 rows for schedules, history, exercises, programs/versions, and coach data. A successful but truncated response is a correctness failure, not merely a performance issue.

Current startup composes 12 parallel workspace branches. Depending on data, startup may fan out to roughly 20–40 Data API requests. It fetches templates, the full exercise library, history, and coach graphs before the default Next-workouts screen can mount.

`loadCoachedAthletes()` loads and aggregates a large historical graph client-side. This will not scale to a coach with 100–250 athletes.

`saveSessionDraft()` resends the full draft using sequential per-item writes. Debounced saves can overlap, arrive out of order, partially succeed, or race completion.

#### Build a separate scale fixture

Keep the nine-person UX fixture. Add a separate deterministic local/staging scale fixture containing representative boundaries such as:

- 1,000+ accounts;
- coaches with 10, 100, and 250 athletes;
- accounts with 10, 100, and 250 programs;
- programs with up to 52 weeks and realistic workouts/items;
- programs with multiple historical versions;
- 1,001 and 5,000 scheduled occurrences;
- 1,001 and 5,000 completed sessions;
- 5,000 global/personal exercises;
- the maximum supported multi-athlete assignment batch.

Measure cold/warm bootstrap, program catalog, full detail, preview/start, autosave/finish, current and historical calendar months, coach list/overview/agenda, assignment, publish, and draft creation.

For each flow capture request count, peak concurrency, rows, response bytes, p50/p95/p99 browser duration, database time/buffers, mapping/render time, memory, cache hits, retries, and cancellation.

Use authenticated/RLS-aware `EXPLAIN (ANALYZE, BUFFERS, WAL)` against final query shapes and production-like cardinality. Use `pg_stat_statements` in a nonproduction performance environment where available. Add indexes only from evidence.

#### Target read boundaries

Replace the monolithic workspace with screen-oriented data ownership:

- Bootstrap: profile, active session, and immediate next/upcoming summaries.
- Programs: paged program/quick-workout summaries.
- Program detail: the exact selected version/tree, cached by immutable ID/version.
- Calendar: the requested month plus a small adjacent range.
- Exercises and templates: lazy, searchable, paged, and independently cached.
- Coaching: paged athlete summaries; selected athlete and agenda loaded separately.
- Completed results: summary pages and on-demand detail.

Server-side views/RPCs are appropriate when they replace expensive client join chains and return bounded screen-specific aggregates. Do not replace one giant client workspace with one giant JSON RPC.

#### Write safety

- Replace session autosave with one atomic bulk operation, a revision/idempotency key, and one serialized latest-write-wins client queue.
- Completion must flush/confirm the latest draft before making the session immutable.
- Make start/resume, draft creation, quick-workout assignment, and other repeatable actions idempotent under two tabs or retries.
- Move remaining compound writes such as workout + default sections and item + prescription into transactional boundaries.
- Cache and invalidate targeted entities instead of reloading the whole workspace after each mutation.

Starting performance budgets to confirm after baseline measurement:

- Default authenticated bootstrap: no more than six bounded Data API calls.
- One program/workout/session detail open: no more than two calls.
- Request count per page is O(1), not proportional to athlete/program count.
- Shaped mobile-4G p95 bootstrap at or below 2.5 seconds.
- Cached navigation p95 at or below 500 ms.
- Screen-summary database queries p95 at or below 200 ms in the scale environment.
- No initial response includes full history, exercise, template, or coach graphs unless the screen requested them.
- No silent truncation, statement timeout, connection-pool exhaustion, or partial compound write.
- Initial bundle must not regress from the measured baseline; split by route/feature and agree a smaller initial-JS target after measuring real devices.

Acceptance: large-data correctness tests pass, the request/payload graph is bounded, autosave is ordered and atomic, and before/after evidence demonstrates the improvement.

### Phase 4 — behavior-preserving architecture extraction

Do this incrementally behind tests. Suggested feature boundaries are:

- app shell, route/navigation state, auth/bootstrap, notifications, and dialogs;
- Programs/catalog and program builder;
- Workout preview/session/logging;
- Calendar/scheduling;
- Exercises;
- Coaching;
- Account/settings;
- shared domain policies, selectors, formatting, and units;
- feature-specific data gateways/query hooks.

Required outcomes:

- Views and presentation components do not call the repository directly.
- Repository responsibilities are split by bounded domain/read model rather than one giant class.
- Server data has one canonical representation; selected entities are IDs or explicit local drafts rather than copied server objects.
- Route/detail origin and dialog state use discriminated unions rather than `ModalName` plus many parallel target fields.
- Workout-log typing updates isolated local state and does not recompute every program, schedule, and coach selector.
- Immutable detail is cached by stable ID/version; account-scoped caches are purged on sign-out/switch.
- Pure transformations currently near the top of `LiftLogApp.tsx` move to tested modules.
- There is one date-only/timezone utility, one initials utility, one units utility, and one status/provenance mapping.

Do not set arbitrary line-count goals. Success means the root app composes features and routing rather than implementing them, and each feature can be tested without mounting the whole product.

Acceptance: no unexplained behavior or screenshot changes, no duplicated canonical server state, and targeted mutations do not trigger unrelated full reloads.

### Phase 5 — reusable UI and visual consistency

Build a small application-owned design system from current successful patterns. At minimum review and consolidate:

- Button, AsyncButton, IconButton, and destructive variants;
- dialog/modal shell, confirmation dialog, focus handling, and mobile presentation;
- PageHeader, action bar, back behavior, loading/error/empty states, inline alert, and toast;
- form field, label, input, textarea, native/custom select, and validation messages;
- Source/Provenance tag, Object type tag, Status badge, RPE indicator, and program progress squares;
- Avatar/person row;
- segmented tabs/navigation;
- Program/TrainingContent card shell with slots for metadata, progress, status, and allowed actions;
- Workout card/detail, Section header, Exercise row, and Workout item presentation shared across preview, builder, calendar, Next, and Coaching.

High-value existing duplication:

- `ProgramRow`, `LibraryTemplateCard`, and coach-assigned program markup use the same object grammar but separate implementations.
- Async progress is frequently implemented manually despite `AsyncButton`.
- Raw avatar markup bypasses `PersonAvatar`.
- Destructive confirmation mixes `window.confirm` and several custom dialogs.
- Planned and actual RPE selectors duplicate incomplete custom-listbox behavior.
- Status labels and date/initial/units formatting are repeated.

Use composition and clear modes instead of one component with dozens of unrelated booleans. A shared shell may expose typed slots; domain-specific behavior should stay in feature adapters.

Refactor CSS only with coverage and screenshots:

- expand tokens to type, spacing, radius, control size, layer, focus, and semantic color;
- fix undefined `--danger` and `--lime` tokens;
- identify dead selectors with coverage before deleting them;
- remove repeated responsive overrides as their components are extracted;
- document component states: default, hover, focus, pressed, disabled, loading, empty, error, and destructive.

Acceptance: the same entity/state/action renders with the same vocabulary, placement, accessibility, and visual treatment in every feature.

### Phase 6 — mobile-first interaction and accessibility

Treat mobile as a separate interaction model, not just collapsed desktop CSS.

Known risks to verify and fix:

- signed-in shell safe-area insets, including notch and landscape;
- toasts overlapping fixed bottom navigation;
- many 6–10 px metadata/calendar text sizes;
- 8×8 calendar dots that lose workout identity;
- hover-revealed calendar delete actions;
- native calendar drag behavior on touch;
- drag-only builder ordering with no move-up/down fallback;
- controls below a 44×44 px frequent-touch target;
- custom listboxes lacking arrow keys, Escape, focus management, and outside-click dismissal;
- set/prescription inputs without explicit accessible names;
- tab semantics without keyboard navigation or tab-panel relationships;
- navigation without `aria-current`;
- toasts without live-region semantics;
- inconsistent dialog focus/body-lock/Escape behavior;
- no native submit behavior for many forms and uncertain soft-keyboard actions;
- state-only navigation with undefined browser Back, mobile back-gesture, reload, and deep-link behavior;
- autosave during background/offline/reconnect and no explicit last-saved/unsaved model;
- no runtime error boundary;
- no declared minimum browser support despite modern CSS/JS features.

For small-screen calendar, prefer an identifiable selected-day agenda/list in addition to compact month markers. Never make a destructive or required action hover-only. Every drag workflow needs tap/button and keyboard alternatives.

Acceptance:

- Critical journeys work at 320, 360, 390, and 430 px plus tablet and desktop.
- No document-level horizontal overflow; intentional inner scrollers are accessible.
- Frequent actions meet the chosen 44×44 px touch target.
- Safe areas, bottom navigation, keyboard opening, long labels, loading/error/empty states, offline/resume, reduced motion, and 200% zoom are verified.
- Automated accessibility has no serious/critical violations, and keyboard-only operation works.
- Real iPhone Safari and Android Chrome smoke checks pass before release.

### Phase 7 — final regression, capacity, and release gate

Run the full suite and report evidence, including:

- lint, typecheck, build, unit, component, integration, E2E, visual, accessibility, database lint, performance, and load tests;
- desktop Chromium/Firefox and mobile Chromium/WebKit;
- large-data fixtures and concurrency cases;
- bundle/request/payload/query-plan before-and-after tables;
- real-device results or an explicit remaining manual-test gap;
- console errors, failed requests, and accessibility violations;
- security/RLS results for athlete, active coach, unrelated user, and revoked coach.

Do not deploy to production as part of this review. A dev deployment should happen only after the local gates pass and should retain rollback instructions.

---

## Critical journeys that must remain working

Use the existing personas deliberately, plus isolated generated users for concurrency/scale tests.

1. Authenticate, recover from workspace-load failure, switch test persona, and sign out without leaking cached account data.
2. Create a program and quick workout; rename; add/copy/delete weeks; add/reorder/delete workouts, sections, and exercises; prescribe; save; publish.
3. Browse Library/Own/Coach content with correct source, object type, lifecycle, availability, actions, and permissions.
4. Make published content available, schedule every occurrence, reschedule, remove, skip, restore, complete, and repeat a finite program.
5. Open the same workout detail from Next, Calendar, Programs, and Coaching with correct Back behavior and navigation highlight.
6. Start exactly once; enter sets, results, and intervals; edit actual RPE; autosave; go offline/background/reload; resume; finish exactly once; review immutable results.
7. Verify planned versus actual RPE, tracking-field-specific inputs, and kg/lb plus km/mi behavior.
8. Verify date-only behavior across timezone and DST boundaries and completion on the scheduled date.
9. Create/cancel/accept/decline coaching requests, end a relationship, and verify immediate loss of access.
10. Assign a program or quick workout to one and many athletes, including the quick-workout-for-tomorrow flow; prove multi-coach isolation.
11. Preserve completed history after program deletion, assignment, publishing, superseding, and relationship revocation.
12. Exercise every destructive confirmation, retry, double-click guard, optimistic rollback, and partial-failure path.
13. Complete all dialogs, listboxes, tabs, navigation, calendar actions, and reorder operations with touch and keyboard.

Suggested persona coverage from the checked-in fixture:

- Egils Levits: first-login/onboarding and empty states.
- Jānis Čakste: self-coached programs, scheduling, history, and logging.
- Gustavs Zemgals: outgoing invitation creation/cancellation.
- Valdis Zatlers: coach with multiple athletes plus personal athlete workspace.
- Guntis Ulmanis: multi-coach scoping and isolation.
- Raimonds Vējonis: dual athlete/coach mode switching.
- Edgars Rinkēvičs: coach workspace with no athletes.

---

## Browser and device matrix

Run on every review/PR:

| Target | Viewport/input | Purpose |
| --- | --- | --- |
| Chromium desktop | 1440×900, mouse and keyboard | Main desktop behavior |
| Chromium Android | 360×800 and 412×915, touch | Small and normal Android |
| WebKit iPhone | 375×667, touch | Small-screen Safari smoke |
| Tablet | 768×1024, touch | Breakpoints and touch layout |
| Desktop at 200% zoom | keyboard | Reflow, focus, and readable controls |

Run nightly or before a release:

- WebKit 390×844 with safe-area coverage;
- landscape 844×390;
- Firefox desktop;
- widths immediately around 520, 700, 900, and 1250 px;
- reduced motion and high-contrast/forced colors where supported;
- slow network, CPU throttle, packet loss, offline/reconnect, and page background/foreground;
- real iPhone Safari with VoiceOver and Android Chrome with TalkBack/soft keyboard.

Define the supported minimum iOS Safari and Android Chrome versions as part of this review.

---

## Definition of done

The stabilization pass is complete only when all of the following are true:

- The product glossary, lifecycle model, provenance model, and capability matrix are documented and reflected in UI, TypeScript, repository guards, RPCs, and RLS.
- Lint, strict TypeScript, build, local database lint, and all test layers pass without broad ignores.
- Critical behavior is protected by executable unit/component/database/browser tests, not only source-string contracts.
- Every public repository mutation category has behavioral coverage at the correct boundary.
- Loading is screen-oriented, bounded, paged where data grows, cached by stable identity, and observable.
- There is no silent 1,000-row truncation, request fan-out proportional to data size, lost autosave, partial compound write, or duplicate-start/draft/assignment race.
- Root state no longer duplicates canonical server entities, and workout typing does not rerender/recompute the whole workspace.
- Feature views, data access, domain policies, and shared presentation are independently testable.
- Reusable entity cards, actions, async states, forms, dialogs, tags, statuses, and workout presentation replace local reinventions.
- The same source/status/action has the same wording and appearance across Programs, Next, Calendar, and Coaching.
- Mobile critical flows meet touch, readability, safe-area, offline, Back-navigation, and accessibility expectations.
- Bundle, request count, payload, database latency, render time, and load-test metrics have explicit non-regression budgets and before/after evidence.
- Security and RLS behavior remains correct for athlete, coach, unrelated user, and revoked coach.
- Documentation describes the architecture that actually exists after cleanup.

---

## Required final report format

When finished, return:

1. **Executive summary** — what materially improved and what remains risky.
2. **Findings** — P0/P1/P2 items with exact files/symbols and evidence.
3. **Product model** — glossary, state/lifecycle diagram, provenance model, and capability matrix.
4. **Changes by phase/commit** — small enough to review or revert independently.
5. **Performance table** — before/after requests, bytes, p50/p95/p99, DB plans, render time, memory, and bundle size.
6. **Testing table** — commands, pass/fail/skip counts, coverage by layer, browsers/devices, accessibility, and load profiles.
7. **Visual/mobile evidence** — reviewed screenshots and any deliberate differences.
8. **Security and data-integrity evidence** — RLS roles, concurrency, idempotency, immutability, and revocation.
9. **Remaining decisions or debt** — explicitly bounded, prioritized, and not disguised as completed.
10. **Release recommendation** — ready for dev, ready for production review, or blocked, with reasons and rollback notes.

Lead with findings and evidence. Do not report success merely because code was moved into more files.
