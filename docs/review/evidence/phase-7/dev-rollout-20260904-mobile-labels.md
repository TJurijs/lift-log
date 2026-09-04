# Development rollout: mobile card labels and workout preview

Date: 2026-09-04 UTC

- Application commit: `c63d3662dfead055510d65620a224e20f8f89c9b`
- Target: `https://dev.liftlog.cc`
- Release: `/srv/liftlog/nonprod/releases/20260904T215439Z`
- Retained rollback: `/srv/liftlog/nonprod/releases/20260904T212108Z`
- Database, Nginx, and production changes: none

Removed View program from workout previews and deleted its unused navigation
handler, callback prop, and return-route state. The remaining preview actions
and normal program navigation are preserved.

Mobile program cards now give the title and footer their full available width.
Status text remains on one line; complete controls can move to a following row
when needed. This removes the fixed 112px footer and 104px badge restriction
that caused In use and Editable template labels to wrap. The workout selector
label also stays on one line, while preserving the native selector.

Verification:

- `ci:verify` passed: lint, TypeScript, production build, 205 legacy checks plus
  one intentional skip, 517 behavior tests, and bundle budgets.
- Local UI with Docker Supabase passed Chromium/WebKit checks at 320, 360, 393,
  and 412 pixels for single-line, unclipped status labels and no page overflow.
  Existing active and editable fixture programs were both checked.
- Local and hosted browser checks covered the workout picker and an existing
  calendar workout preview. View program was absent and calendar removal
  remained available. Checks used read-only fixture navigation and a browser
  clock aligned with fixture dates; no fixture data was changed.
- Hosted Chromium and WebKit checks passed after deployment; screenshots were
  visually inspected. No page errors or attempted application data writes were
  recorded.
- Fresh nonproduction build and bundle budgets passed. All 24 uploaded files
  matched local SHA-256 hashes before the atomic frontend switch.

Evidence is under ignored `artifacts/ui-labels/`. GitHub CI was running when
deployment completed: [run 33923206205](https://github.com/TJurijs/lift-log/actions/runs/33923206205).

Rollback is an atomic repoint of nonprod `current` to the retained release,
followed by the ordinary route, release metadata, and browser smoke checks.
