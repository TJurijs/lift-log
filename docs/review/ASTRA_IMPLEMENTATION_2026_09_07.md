# Astra review implementation — 7 September 2026

This records the follow-up to `ASTRA_REVIEW_2026_09_07.md`, against baseline commit `392d0e57af0f05bd07b4ba07ed927e50eaa065c1`. The fixes are in the local working tree. Five forward migrations are applied to the existing local Supabase database; no hosted database, deployment, branch push or production setting was changed.

## Correctness and usability fixes

| Review item | Implemented behavior | Verification |
| --- | --- | --- |
| F01: previews clear active logs | Preview selection is separate from the active workout form. Switching previews does not reset or autosave cleared active fields. | Permanent full-app regression in `active-workout-reload.test.tsx`. |
| F02: decimal input changes meaning | `MeasurementInput` retains the typed decimal separator and trailing zeroes, while autosave receives canonical kg/km values. Supports dot/comma input, deletion and leading decimals. | Character-by-character kg/lb and km/mi tests, including unit changes. |
| F03: draft duplication fails | Copying the current draft clones its current content under a lock and links lineage only to an eligible immutable revision. | Real SQL tests for unused/used programs and quick workouts; copied content can be edited independently. |
| F04: completion uses stale metadata | Finish uses the confirmed snapshot, revision and idempotency token together. Revision conflicts recover and rebuild the completion request. | Full-app merge/completion regressions and existing persistence tests. |
| F05: edits accepted during Finish disappear | Logging, reset and skip controls freeze for the completion transaction, then unlock if it fails. | Delayed completion regression verifies the disabled controls and recovery. |
| F06: program metadata disappears on navigation | Title/description autosave through a serialized controller. Feature navigation, browser Back, Start/Assign and sign-out flush pending changes. Failed saves retain the draft and show a retryable error; tab closing warns while changes remain. | Deferred/error controller tests and real browser navigation, Back and keyboard flows. |
| F07: repeated exercise submissions | Authoring dialogs use a synchronous submission lock, disabled pending controls and safe dismissal behavior. | Deferred double-submit regression; actual create/edit/save/reopen/delete browser flow. |
| F08: distance preference ignored | Logging, interval/result inputs, prescriptions, summaries and completed details use the chosen km/mi unit; storage remains km. | Conversion and preference-change tests plus completed-history regressions. |
| F09: older active plans appear absent | A partially loaded coach history states that more training is available, offers Load more, and avoids presenting zero/empty as definitive. | Regression with 25 finished plans before the active plan on the next page. |
| F10: Calendar bypasses plan order | Individual date changes use the same ordered scheduling transaction and run lock as the plan wizard. | Real SQL invalid-order rejection and valid scheduling tests. |
| F11: invisible search focus | Search wrappers show a visible focus-within outline even when the inner input resets its outline. | Browser keyboard checks and responsive screenshots. |
| F12: video dialog focus escapes | Video and normal dialogs share initial focus, containment, Escape handling, scroll locking and opener restoration, including focus returning from an iframe. | Modal behavior tests and existing dialog accessibility tests. |
| F13: incomplete RPE keyboard control | Extracted RPE controls support opening focus, arrows, Home/End, selection, Escape/Tab and selected-value announcements. | Dedicated keyboard regression suite. |
| F14: development cleanup breaks promotion | A guarded promotion runner classifies 11 hash-pinned historical personal-data operations separately from schema delivery, records atomic receipts, validates exact targets and preserves applied history. | Complete 84-migration replay into a separate database with the historical account present; account preserved, repeat promotion idempotent. |
| F15: updates invalidate open app chunks | A new worker waits for old clients to close. Each installed worker serves its matching document/assets. Cache retirement happens at normal activation. | Real two-release browser regression: removed origin assets, online/offline reload, an unloaded lazy feature, retained draft and next-session activation. |

The additional publication race was reproduced with real concurrent connections. The draft-tree trigger now locks the version and rechecks its status, including direct writes and cross-version moves. Append operations use compatible locks. Both publication/edit interleavings pass tests that assert actual PostgreSQL blocking rather than relying on sleeps.

The extracted coaching controller also exposed three additional races: old pages restoring removed athletes after refresh, old detail requests suppressing fresh reads, and refresh loading a previously selected athlete. New regressions reproduce each one. Request generations and current selection checks now prevent those stale updates. Scheduling likewise discards an older response after a refresh or explicit program selection.

## UI consistency and structure

- Primary program and plan actions have visible Start/Schedule labels. Secondary actions use one shared More menu with keyboard dismissal and focus restoration.
- Program labels consistently distinguish reusable templates, training plans, workouts and results. Save status/error feedback is explicit.
- Small captions use a 12px minimum across the main UI and feature styles. Mobile Calendar statistics are compact; at 320px its seven day controls retain 44px targets inside the panel.
- Demo Start now creates a real local session. Logging, reset, completion and opening its saved results work together. Demo-only construction code is excluded from production where demo entry is disabled.
- Active form state, RPE/measurement inputs, program catalog, authoring dialogs, metadata saves, coaching and scheduling controllers moved into feature modules. The main component fell from 9,738 to approximately 8,126 lines. This is an incremental refactor; the remaining orchestration and repository still warrant care as features grow.
- Feature-specific repository interfaces share one authoritative authenticated client. Workflow regressions now exercise behavior; retained source checks protect specific invariants and tolerate feature extraction/grouped CSS.
- Dialogs and related program authoring screens share a lazy chunk. The set of modules eagerly loaded at startup is unchanged. Production omits development frame CSS. Redundant style rules were removed without lowering text sizes or increasing budgets.

## Operations

`docs/DATABASE_MIGRATIONS_AND_CONTRACT.md` documents the promotion runner, generated schema/function/RPC-permission inventory, diagnostics and restoration procedure. New commands are wired into the isolated database CI job. The existing local database was not reset to run them.

The optional authenticated telemetry transport batches only validated numeric/enum envelopes, strips names, IDs and arbitrary text, retains operation outcomes, and drops its memory queue on account changes. The server accepts at most 10 events per request and 20 per account/minute. Event rows contain no account IDs; a separate short-lived private ledger provides rate limiting. Events expire after seven days, with scheduled pruning. Read-only diagnostics report release aggregates and signal configured error/failure/retention alerts by exit code.

An actual browser-to-local-collector test passed and verified that injected private fields never reached the request payload. SQL tests verify denied client table access, malformed-event rejection, rate limits and retention. The diagnostics test verifies the actual alert exit code. `VITE_ENABLE_REMOTE_TELEMETRY` remains **false by default**: apply and verify the collector migration on a deployment target before enabling its frontend flag.

The local backup/restore rehearsal restored a logical archive into a newly created disposable database and compared data counts, validated constraints, function bodies/privileges, RLS policies and triggers. The final database report matched **50 tables, 1,480 rows, 291 constraints, 135 functions, 48 RLS policies and 47 triggers**, with the source unchanged. Private backup archives stay ignored locally; CI uploads only the non-sensitive report. This does not establish hosted backup/PITR, OAuth, storage-object, secret or provider-configuration recovery.

## Verification

| Check | Result |
| --- | --- |
| `npm run ci:verify` | Passed: ESLint, TypeScript, validated production build, 213 legacy tests (one intentional skip), 550 behavior tests across 67 files, and unchanged bundle budgets. |
| Coverage | 70.41% lines / 61.80% branches overall, versus 65.87% / 57.54% at review. Main component 36.06% lines / 34.65% branches. Coverage remains uneven; it is not proof that every workflow is covered. |
| Real SQL | Existing integration, authoring and V1 smokes; new copying/publication/order, telemetry, diagnostic, portability and restoration checks passed. Database lint passed. |
| Authenticated browser matrix | Final run: **34 passed, zero failed, 30 intentional project/environment skips** across desktop Chromium/Firefox and mobile Chromium/WebKit. Covers authoring, navigation, accessibility checks, 320px layout, offline/reconnect, cross-tab ownership and independent-device conflicts. Telemetry's enabled-build test passed separately. |
| Responsive/keyboard inspection | 320px, 390px and 1440px demo layouts; program menus, editor, Today, Calendar, Exercises, development preview and coach detail/back flow passed. No page errors or visible overflow in inspected screens. |
| Local runtime budget gate | Passed, five warm samples per screen; zero blocked writes, page errors or console errors. These loopback results do not establish production latency or concurrent-user capacity. |
| Remote telemetry delivery | Passed in a separately built local frontend with the flag enabled; production configuration unchanged. |

Final production bundle, measured with the existing checker:

| Metric | Raw bytes | Gzip bytes | Gzip limit |
| --- | ---: | ---: | ---: |
| Initial JavaScript | 424,602 | 120,923 | 130,000 |
| Largest asynchronous chunk | 165,980 | 44,519 | 45,000 |
| Total JavaScript, including worker | 804,871 | 224,780 | 225,000 |
| CSS | 119,832 | 21,386 | 22,000 |

The total JavaScript budget still has little headroom. Future features should remove duplication or adjust loading boundaries before adding code; the limits were not raised.

### Evidence and remaining limits

Local evidence is under `artifacts/astra-review/`: `implementation-ci.log`, `implementation-coverage.log`, `implementation-e2e-final.log`, `implementation-runtime-gate.json`, `runtime-local.json`, `implementation-telemetry-browser.log`, `visual-authoring.json`, `keyboard-authoring.json`, and the browser screenshots/reports. Generated effective database contracts are under `artifacts/database-contract/`; recovery report JSON is under `artifacts/recovery/`.

Full offline reload passes Chromium, Firefox and mobile Chromium. Playwright's Firefox interception initially bypassed the worker; the permanent test now disables interception only after networking is disabled and restores the external-request guard before reconnecting. The actual app then passes. A separate no-interception probe still makes Playwright WebKit throw an internal offline-navigation error; its existing full-offline test skip remains. WebKit's online authoring, reconnect, cross-tab and independent-device conflict journeys pass. The separate two-release worker regression passes desktop Chromium/Firefox and mobile Chromium. See `ASTRA_BUNDLE_VALIDATION_2026_09_07.md` for the browser/chunk evidence.

Physical phone testing with the native keyboard/enlarged text, formal accessibility/usability research, production-network measurements and hosted recovery remain external validation tasks. No deployment is claimed by this implementation record.
