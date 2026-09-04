# Development rollout: hosted mobile preview

Date: 2026-09-04 UTC

- Target: `https://dev.liftlog.cc/?preview=mobile`
- Final application commit: `716ed6e6774e58e459ed84d8c5adac25b5ec2926`
- Final release: `/srv/liftlog/nonprod/releases/20260904T212108Z`
- Immediately preceding release: `/srv/liftlog/nonprod/releases/20260904T211720Z`
- Release before this fix: `/srv/liftlog/nonprod/releases/20260904T204730Z`
- Database changes: none
- Production configuration/behavior changes: none

## Problem and fix

The preview was gated by Vite's `DEV` flag, which is false in a compiled
nonproduction build. Hosted development also sent `X-Frame-Options: DENY`,
blocking the same-origin iframe used to apply actual mobile viewport queries.

Preview now works in the development server and compiled `nonprod`/`localdev`
builds. The `preview=mobil` shorthand is accepted and the child URL is
canonicalized to `preview=mobile&preview_frame=1`. Production still omits the
preview UI. Dev permits same-origin framing; production still disallows framing.

The iPhone 15 and Samsung Galaxy A54 presets preserve the current login and
navigation while resizing. The selector uses the dark native color scheme so
its text remains legible in WebKit.

Google sign-in from a preview frame opens in the same-origin outer window.
The outer preview consumes the auth callback before creating a child, removes
credentials from the URLs, and shows a retry after failed initialization. A
previous account cannot mask failed callback initialization. Accepted coach
invitation tokens are removed from both matching preview URLs, preventing a
used token from being replayed on outer reload.

## Verification

- Final JavaScript quality gate: lint, TypeScript, production build, 205 legacy
  checks plus one intentional skip, 517 behavior tests, and bundle budgets.
- Local UI with Docker Supabase: Chromium and WebKit passed signed-in preview,
  both viewport presets, persistent navigation, and top-level OAuth handoff.
- Compiled local UI with Docker Supabase: the same four browser checks passed.
- A real local Supabase session passed the outer OAuth callback path; credentials
  disappeared from the outer URL before the signed-in iframe was created.
- Invitation acceptance/reload and auth callback failure regressions passed.
- The final one-line selector style change passed WebKit browser verification,
  a fresh nonproduction build, and bundle budgets.
- Both hosted Chromium and WebKit smoke checks passed on the final release:
  signed-in preview, both presets, exercise navigation, sign-out, and OAuth
  handoff. The provider redirect was intercepted before Google; no interactive
  Google consent flow was performed by the test.
- Final hosted runs recorded no browser errors, HTTP failures, unexpected
  origins, or attempted application data writes. Screenshots were inspected.
- CI now includes the preview test against the compiled local app, alongside
  the existing offline reload check.

## Deployment and rollback

All 24 uploaded files matched local SHA-256 checksums. Both frontend switches
were atomic and retained the previous release. HTML and preview URLs return
HTTP 200 with uncached HTML and the final release metadata. Development sends
`X-Frame-Options: SAMEORIGIN`; production still returns its maintenance response
with `X-Frame-Options: DENY`.

The live Nginx file matched the previous tracked configuration before the
dev-only header change. Its backup is
`/etc/nginx/sites-available/lift-log.pre-mobile-preview-20260904T211720Z`.
Configuration replacement was followed by successful `nginx -t` and reload.

For a frontend rollback, atomically repoint nonprod `current` to the desired
retained release. To undo the complete preview rollout, also restore the Nginx
backup atomically, validate with `nginx -t`, and reload. No database rollback is
needed.

Ignored local evidence is under `artifacts/mobile-preview/`; the final quality
log is `artifacts/mobile-preview-quality-final.log`. Earlier live smoke output
diagnosed WebKit's cancelled background requests when the test navigated before
bootstrap settled; the final smoke waits for settled navigation and passes.
