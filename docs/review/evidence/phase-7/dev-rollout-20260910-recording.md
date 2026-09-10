# Development rollout: exercise recording, instructions and videos

Date: 2026-09-10 UTC

- Application commit: `3a1243be5a09853edfa77887f7c53dd67a1f0448` (includes feature commit `eec63b885185f0c58ee9300970ef487e34852e56`).
- Target: https://dev.liftlog.cc
- Active release: `/srv/liftlog/nonprod/releases/20260910T190315Z`.
- Retained frontend rollback: `/srv/liftlog/nonprod/releases/20260910T073000Z`.
- Database: development project `ofyeejyfroblunbspgve`; 89 applied migrations, none pending.
- Production changes: none.

The release unifies recording configuration, corrects 84 reviewed catalog defaults,
starts actual measurements blank, displays complete exercise instructions, and
adds ordered, labeled custom video links. New sessions snapshot instructions and
videos. Migration `202609100005` rejects stale clients that cannot represent timed
set measurements; current clients retain intentional clearing and safe recovery
of an older pending save after upgrading.

## Validation and activation

[GitHub Actions run 34517866678](https://github.com/TJurijs/lift-log/actions/runs/34517866678)
passed both required jobs before hosted migration or site activation:

- 695 behavior tests, 254 legacy checks (9 environment-specific skips), lint and TypeScript.
- Production build and all bundle budgets; total JavaScript 812,805 raw / 226,505 gzip bytes,
  largest asynchronous chunk 44,526 gzip bytes, CSS 119,996 raw / 21,455 gzip bytes.
- Fresh Docker/Supabase startup, database integration and authoring contracts,
  recording/video SQL smoke checks, portable replay, recovery and scale checks.
- Desktop Chromium and mobile WebKit journeys: 30 passed, 10 intentional skips.
- Built-app offline/mobile checks: 3 passed; runtime performance gate passed.

The initial release candidate exposed a mobile WebKit handover race: closing the
editing tab could resolve before the browser released its native lock. Explicit
retry now allows a bounded, cancellable two-second handover window, keeps immediate
blocked feedback, and never steals a live writer's lock. Tests cover delayed
release, a live owner, cancellation and late grants. The original browser
assertions passed without increasing their timeouts.

A fresh nonprod build contained the exact application SHA and development binding.
All 19 uploaded files matched local SHA-256 checksums. The current symlink switched
atomically after its previous target was checked. Live root, SPA fallback, static
assets and service-worker requests succeeded; release metadata, non-cached HTML,
immutable assets and development framing headers matched expectations.

Authenticated live checks at 1440px and 390px passed navigation, program detail,
Plank's Time configuration (retaining the existing optional RPE preference), the
Record/video editor and sign-out, with no page errors or horizontal overflow.
The hosted-development integration suite passed with isolated fixtures and cleanup.

The user's development tab was refreshed to the exact release. Its template showed
four Side plank time sets of 30 seconds and the combined Day 2 exercise with complete
2+1 instructions. Both labeled video controls opened their corresponding YouTube
embeds from zero with controls enabled. The revised Day 2 template remains open for review.

## Future workout template

The reviewed working draft of **Weightlifting Foundations — 1 Week / 3 Days** was
updated in one guarded serializable transaction, reducing 26 items to 24:

- Day 1: Side plank is four timed sets of 30 seconds, retaining side alternation,
  rest, effort and the original prescribed-entry identities.
- Day 2: **Power clean + push jerk**, four sets of three total reps (2+1), with
  two labeled demonstration videos. Earlier standalone jerk work remains unchanged.
- Day 3: **Clean + push jerk**, three sets of two total reps (1+1), with two videos.

The updater verified published content, existing schedules, active/completed
sessions and unrelated exercises were unchanged. Read-only inspection afterward
reported `already-applied` and the exact expected result. The private plan SHA is
`deb73d186dc93cd18cfa7cb06f5963d50661a5ab5daf7336e72783f64a19a7da`.
See the [operator guide](../../../ops/DEV_COMPLEX_TEMPLATE_UPDATE_2026_09_10.md).

New runs from the reusable template automatically consume this working draft.
Existing schedules and repeating an existing run continue to use their original
immutable version. No separate publish operation was needed.

## Recovery evidence

Before hosted changes, a refreshed private custom-format archive of Auth, public,
private and migration schemas/data was saved outside Git. Size: 1,034,953 bytes;
SHA-256 `cc290fe6f0d1756260f857416e866dbe00a0ceee2e651c68e4121ed2b1025190`.
It restored successfully into a disposable local database with 13 accounts and
84 pre-release migration entries. Only provider-owned future DEFAULT ACL templates
were omitted from the local restore; the original archive retains them.

All five forward migrations applied successfully. The previous static release is
retained for frontend rollback; no destructive database rollback or account reset
was performed. Private archives, the reviewed personal plan, screenshots and logs
remain under ignored `artifacts/dev-release-20260910-recording/`.
