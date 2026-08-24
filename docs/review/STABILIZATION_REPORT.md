# Lift Log stabilization report — 2026-08-24

## 1. Executive summary

The review moved Lift Log from a mostly structural test suite and failing lint/integration baseline to a materially safer development state:

- the recorded local gate covers lint, strict TypeScript, production/nonproduction builds, 111 ordinary tests plus one intentional hosted-integration skip, 185 behavioral/component tests, dependency audit, and the four-engine browser matrix; the final hosted-development integration, linked database lint, and signed-in browser smoke also pass;
- product terminology, lifecycle axes, provenance, and viewer-relative capabilities now have one documented contract and executable policy tests;
- date-only/DST behavior, unit conversion, pagination beyond 1,000 rows, immutable-detail caching, latest-write-wins client autosave, error boundaries, modal/error/toast primitives, native RPE/category selects, and mobile calendar interactions have behavioral coverage;
- repeated warm coaching reloads fell from 29 requests / 72,343 bytes to zero requests for My coaches and at most one lazy detail request for My athletes, Raimonds' authenticated bootstrap fell from 29 requests / 73,813 bytes to 22 requests / 67,728 bytes through the bounded coach-workspace RPC, and the nonproduction initial JavaScript entry fell 27.7% through an authenticated-shell split;
- the guarded hosted-development integration path now creates only exact namespaced users, verifies their test markers, exercises RLS and lifecycle behavior, and proves cleanup. No generated users or profiles remain.

This is ready for the hosted-development pilot and continued development review, but **blocked for production review**. Development migrations through `202608240008` are applied to project `ofyeejyfroblunbspgve`, and the compatible frontend is live at `https://dev.liftlog.cc` from `/srv/liftlog/nonprod/releases/20260824T180133Z`. Bootstrap remains above the six-call starting budget at 22 Data API calls, architecture extraction is incomplete, and real-device/offline/large-hosted-scale and query-plan verification remain open. Production was untouched and remains out of scope.

## 2. Findings

### P0

No known P0 remains in the validated development surface. This statement is bounded by the test matrix below and does not substitute for the open real-device, scale, or production-review gates.

### P1

| Finding | Exact surface and evidence | Disposition |
| --- | --- | --- |
| Authenticated bootstrap exceeds the starting request budget | Migration `202608240008` replaces repeated coach-workspace reads with one bounded RPC and lowers Raimonds from 29 to 22 requests and 73,813 B to 67,728 B. Jānis remains at 22 requests / 71,252 B. Both remain above the six-call starting budget. | Split the remaining global bootstrap into profile/active-session/next summaries, then lazy-load Programs, Calendar, Exercises, templates, history, and Coaching. |
| Root/application boundaries remain incomplete | `app/LiftLogApp.tsx` is 9,402 lines with 109 `useState` occurrences, 129 raw buttons, and 13 `repository.loadWorkspace()` calls. Views and orchestration remain coupled despite pure-policy/tree/date/unit extractions. | Continue feature slices; move repository access behind screen gateways/hooks and replace copied entities with IDs/local drafts. |
| Release interaction matrix is incomplete | Automated 320/360/390/430/768 reflow is green and [minimum browser support is declared](../BROWSER_SUPPORT.md), but true 200% zoom, browser Back/deep links, offline/background/reconnect, soft keyboard, VoiceOver/TalkBack, real iPhone Safari, and real Android Chrome were not executed. | Required manual/device gate before production review. |
| Production-like scale and query plans remain unproven | Pagination logic executes 1,001/5,000-row synthetic cases, but hosted dev was not populated with 100/250 programs, 5,000 sessions/exercises, or maximum assignment batches. No authenticated `EXPLAIN (ANALYZE, BUFFERS, WAL)` evidence was captured. | Run an exact namespaced hosted-dev scale fixture with guaranteed reset receipts and capture authenticated query plans. |

### P2

| Finding | Evidence / next step |
| --- | --- |
| Signed-in total JavaScript is slightly above baseline | Total nonproduction app JS is 682.48 kB / 188.72 kB gzip versus 663.56 / 181.56 kB. The initial entry is materially smaller and the oversized-single-chunk warning is gone; continue feature-level splitting. |
| Global behavioral coverage remains low | V8 reports 17.93% statements globally because most of the monolithic root is unmounted. Safety-critical utilities are 90–95% covered, but feature components need independent mounts as extraction continues. |
| Reusable UI consolidation is partial | Modal shell, inline errors, toast/live region, error boundary, RPE/native selects, status/provenance primitives, and selected calendar/workout patterns are shared. Program/card/action/form reinventions and raw buttons remain. |
| Some very small secondary typography remains outside the reviewed calendar/navigation surfaces | Calendar/navigation/library metadata were raised; perform a token-based typography audit rather than isolated selector changes. |

## 3. Product model

The canonical glossary, four independent state axes, lifecycle diagram, provenance projection, capability matrix, tracking/unit/date rules, approved decision set, and alignment status are in [PRODUCT_MODEL_AND_CAPABILITIES.md](../PRODUCT_MODEL_AND_CAPABILITIES.md).

The implemented contract separates:

- content lifecycle: draft → published → superseded;
- availability: unavailable ↔ available;
- occurrence state: planned / in progress / completed / skipped;
- session state: in progress / completed / abandoned;
- durable origin (`library`, `self`, `coach`) from viewer-relative labels such as Library, Own, Coach · You, and Athlete · name.

Pure `deriveTrainingContentCapabilities()` and `deriveOccurrenceCapabilities()` policies now align high-risk UI actions with owner, author, relationship, origin, lifecycle, and availability facts. The database remains authoritative. The coach visibility decision is resolved as author-scoped: an active coach can view only programs they authored for the athlete and the occurrences/results derived from those versions, without private athlete notes.

## 4. Changes by phase/review slice

No commits were created because the assignment did not request committing. The working tree is intentionally left as reviewable file-level slices.

| Phase | Reviewable outcomes |
| --- | --- |
| 0 — baseline | Recorded clean-commit identity, original lint/audit/integration failures, bundle/source profile, browser timings, accessibility/mobile risks, and before screenshots in [PHASE_0_BASELINE.md](PHASE_0_BASELINE.md). |
| 1 — behavior model | Added the product/capability contract, provenance projection, pure capability policies, explicit Unknown origin, independent status vocabulary, centralized date-only and unit utilities. |
| 2 — safety net | Added Vitest/RTL/jsdom/axe coverage, Playwright, behavior suites for policy/date/DST/units/pagination/queues/repository payloads/caches/UI/error boundary/mobile, and fail-closed hosted integration guards. |
| 3 — data/performance | Added bounded paging/batching, selected-detail caches with account disposal, scoped coaching refresh, performance instrumentation/harness, lazy authenticated shell, revisioned transactional draft saving/completion, hosted integration fixture safety, versioned metadata, author-scoped reads, and a bounded coach-workspace RPC. Development migrations through `202608240008` are applied. |
| 4 — incremental extraction | Extracted program-tree transformations, capabilities, provenance, dates, units, pagination, latest-write queue, detail-state union, and a bounded coaching gateway/cache. Full feature/repository separation remains open. |
| 5 — reusable UI | Consolidated modal shell/focus/body lock/Escape behavior, inline errors, toast/live region, error boundary, tabs/panels/navigation state, native RPE/category selects, explicit input names, and removed dead custom-menu CSS. |
| 6 — mobile/accessibility | Rebuilt calendar semantics around native sibling controls, added selected-day agenda and tap/keyboard fallbacks, safe-area/toast/bottom-nav handling, coarse 44 px targets, reduced motion, readable calendar/nav text, and cross-engine responsive tests/screenshots. |
| 7 — release gate | Ran validation, hosted RLS integration, linked schema lint/migration audit, dependency audit, coverage, performance, browser matrix, screenshot inspection, exact fixture-remnant verification, and signed-in desktop/mobile smoke; deployed the development frontend with the preceding release retained for rollback. |

## 5. Performance evidence

The full methodology and earlier samples are in [the Phase 3 baseline](evidence/phase-3/hosted-readonly-performance-baseline.md) and [the scoped-coaching comparison](evidence/phase-3/hosted-readonly-performance-after-scoped-coaching.md).

| Surface | Before | Final measured result | Assessment |
| --- | ---: | ---: | --- |
| Jānis bootstrap requests / content | 22 / 70,040 B | 22 / 71,252 B | Request count unchanged; global bootstrap remains P1. |
| Raimonds bootstrap requests / content | 29 / 73,813 B | 22 / 67,728 B | Migration `202608240008` removes seven calls and 6,085 B; global bootstrap remains P1. |
| Coaching · My coaches p95 | 29 requests, 72,343 B, 54.19 ms ready, 1,384.72 ms settled | 0 requests, 0 B, 56.43 ms ready, 426.69 ms settled | Repeated full reload removed. |
| Coaching · My athletes p95 | 29 requests, 72,343 B, 864.68 ms ready, 1,216.84 ms settled | 1 request, 1,546 B, 58.98 ms ready, 1,418.89 ms settled | Detail is lazy and cached (median zero requests); the cold-detail settled p95 remains a follow-up. |
| Exercise library warm p95 | 144 rows; 85.51 ms ready; 31.16 MB heap | 144 rows; 175.08 ms ready; 31.50 MB heap | Still eager and unwindowed; P1 scale risk. |
| Nonprod initial JS | 663.56 kB / 181.56 kB gzip | 479.85 kB / 135.73 kB gzip | -27.7% / -25.2%. |
| Nonprod authenticated lazy JS | none | 202.63 kB / 52.99 kB gzip | Separate chunk. |
| Nonprod total app JS | 663.56 kB / 181.56 kB gzip | 682.48 kB / 188.72 kB gzip | +2.9% / +3.9%; follow-up. |
| CSS | 96.59 kB / 18.02 kB gzip | 99.87 kB / 18.52 kB gzip | +3.4% / +2.8%. |

Final harness safety: zero writes, zero production/unknown Supabase requests, zero HTTP/transport failures, zero page errors, and zero console errors. Browser transfer headers were incomplete, so body/content bytes are reported rather than invented transfer totals. Database time/buffers/WAL, render-task breakdown, shaped mobile-4G, and p99 are not available and remain explicit gaps.

## 6. Testing evidence

| Layer / command | Recorded result / final hosted result |
| --- | --- |
| `npm run lint` | Pass, zero errors. |
| `npx tsc --noEmit` | Pass. |
| `npm test` | Pass: production build; 111 ordinary tests pass, 1 intentional hosted-integration skip; 185/185 behavioral/component tests pass. |
| `npm run test:coverage` | Pass: 18 files / 185 tests; 17.93% statements globally. `date-only` 95%, latest-write queue 94.82%, pagination 90.9%, error boundary 90.9%. |
| `npm run test:integration:hosted-dev` with all explicit target confirmations | Pass: 1/1 end-to-end hosted-dev scenario in approximately 25.94 s; athlete isolation, exact invitations, author-scoped editing/reads, availability/scheduling, revision conflicts, RLS, immutability, revocation, and cleanup. |
| `npm run test:e2e` | Pass: 10 executed / 6 intentional form-factor skips across desktop Chromium, desktop Firefox, mobile Chromium, and iPhone/WebKit; one worker. |
| Responsive matrix | Pass at 320, 360, 390, 430, and 768 px without document overflow; calendar day target ≥44 px and selected-day agenda present. |
| Accessibility | Component axe assertions pass; public sign-in shell has no serious/critical axe violations in all four browser projects. Keyboard/tab/navigation/dialog/RPE/calendar semantics have targeted behavior tests. |
| `npm run build:nonprod` | Pass; two application chunks; no >500 kB chunk warning. |
| `npx supabase db lint --linked --project-ref ofyeejyfroblunbspgve` | Pass against hosted dev: private/public/extensions, no schema errors. |
| `npx supabase migration list --project-ref ofyeejyfroblunbspgve` | Applied history matches through `202608240008`. Migration `202608240007` contains the PT409 non-retryable revision-conflict correction. |
| Signed-in deployment smoke | Pass at `https://dev.liftlog.cc` on desktop and a 390 × 844 mobile viewport against the active development release. |
| `npm audit` | Pass: zero vulnerabilities. |
| `node scripts/measure-hosted-readonly-performance.mjs --iterations=9` | Pass with safety guards and metrics above. |
| Scale correctness | Synthetic paging passes at 999/1,000/1,001/5,000 rows and bounded 250-ID batches. Hosted large-cardinality fixture and database plans not run. |

## 7. Visual and mobile evidence

Before screenshots are indexed in [Phase 0 evidence](evidence/phase-0/README.md). Final reviewed screenshots and deliberate differences are indexed in [Phase 6 evidence](evidence/phase-6/README.md):

- [desktop calendar](evidence/phase-6/calendar-desktop-1440x900.png);
- [360 px calendar with selected-day agenda](evidence/phase-6/calendar-mobile-360x800.png);
- [360 px exercise library with native filters](evidence/phase-6/exercises-mobile-native-filters-360x800.png).

No unexplained document-level horizontal overflow was observed. The mobile full-page capture deliberately shows the fixed bottom navigation while retaining access to the selected-day agenda below the compact month. Real-device safe-area, assistive-technology, keyboard, and zoom evidence remains open.

## 8. Security and data-integrity evidence

- Hosted mutation target is hard-coded and validated as project `ofyeejyfroblunbspgve` and its exact Supabase origin; lookalikes, URL additions, missing confirmations, loopback/hosted crossover, and identical keys fail closed.
- Secrets were retrieved only from the already-authenticated CLI into child-process environment memory. They were not logged, persisted, placed in `VITE_` variables, screenshots, or reports.
- Every generated Auth user is immediately marked and verified as `account_kind=test` with the exact run namespace before destructive fixture work continues.
- Cleanup validates namespace/persona keys/UUIDs, calls the service-only exact-namespace reset, verifies the receipt, attempts every recorded Auth deletion even after another cleanup error, and aggregates failures.
- The final remnant check found **0 generated Auth users and 0 generated integration profiles**.
- Hosted integration proves unrelated athlete writes are hidden, active coaches can read but only authoring coaches can edit/publish their athlete-specific draft, coaches cannot mutate athlete calendar actions, and revoked coaches immediately lose access.
- Published workout trees and completed session entries reject changes, including service-role writes through the immutable-history triggers.
- Availability atomically prepares schedule occurrences and repeat preparation returns zero; occurrence/session completion preserves the scheduled date.
- Client autosave ordering/flush and start/finish double-click guards have executable tests. The hosted development database now enforces a monotonic transactional draft revision and completion handshake; migration `202608240007` corrects PT409 classification so stale revision conflicts are non-retryable.
- Development migrations through `202608240008` and the compatible nonproduction frontend were deployed and smoke-tested. No production data, production endpoint, production migration, or production frontend was touched.

## 9. Remaining decisions and debt

1. **P1 — data:** replace the remaining eager global workspace bootstrap with screen-owned bounded queries and reach the six-call starting budget; paginate/window Exercises and large program/history/coaching collections.
2. **P1 — architecture:** extract feature controllers/gateways and local draft state until views do not call the repository and root state does not duplicate server entities.
3. **P1 — release QA:** execute real iPhone Safari/VoiceOver and Android Chrome/TalkBack/soft-keyboard, offline/background/reconnect, browser Back/deep links, landscape/safe areas, and true 200% zoom.
4. **P1 — capacity:** run exact namespaced hosted-dev fixtures at 100/250 programs, 1,001/5,000 occurrences and sessions, 5,000 exercises, 52-week trees, historical versions, and maximum assignment batches with authenticated query plans.
5. **P2 — performance/UI:** reduce total signed-in JavaScript, finish reusable card/form/action primitives, raise remaining sub-10 px secondary text through tokens, and mount extracted feature components for materially higher coverage.

## 10. Release recommendation

**Recommendation: ready for the hosted-development pilot and continued development review; blocked for production review.**

Development project `ofyeejyfroblunbspgve` is migrated through `202608240008`; hosted integration, schema lint, and signed-in desktop/mobile smoke pass. The compatible frontend is active at `/srv/liftlog/nonprod/releases/20260824T180133Z`. Production review should not begin until the remaining global bootstrap and large-cardinality/query-plan behavior meet the approved envelope and the real-device/offline matrix passes.

The final cutover did not trigger rollback; earlier failed rollout attempts were rolled back successfully and are recorded in [the development rollout evidence](evidence/phase-7/dev-rollout-20260824.md). `/srv/liftlog/nonprod/releases/20260823T232214Z` remains the verified frontend rollback target. Any database correction must be a reviewed forward migration that restores compatible definitions/privileges; do not rewrite migration history or manually edit production data. Production remains untouched and out of scope.
