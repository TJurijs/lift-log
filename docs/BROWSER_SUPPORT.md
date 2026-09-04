# Browser support policy

Lift Log targets evergreen browsers with native ES modules, dynamic import, modern Grid/Flexbox, `dvh`, safe-area environment variables, and current form/accessibility behavior.

Minimum supported versions for the current review target:

| Platform | Minimum |
| --- | --- |
| iPhone/iPad Safari | iOS/iPadOS 17.4 |
| Android Chrome | Chrome 120 |
| Desktop Chrome / Edge | 120 |
| Desktop Firefox | 121 |
| Desktop Safari | 17.4 |

The local Supabase pull-request job runs pinned Playwright Chromium and mobile WebKit. `npm run test:e2e` runs the full Chromium, Firefox, Android Chromium, and mobile WebKit matrix. Before a release, test the oldest supported iOS Safari and Android Chrome versions on real devices plus the current stable versions. Include touch, safe areas, soft keyboard, browser Back, offline/reconnect, reduced motion, 200% text/zoom reflow where available, VoiceOver, and TalkBack.

Workout editing requires IndexedDB and the Web Locks API in a secure context
(HTTPS, or localhost for development). One tab owns each active workout's local
journal at a time. Other tabs show a read-only logger with a retry action;
closing the editing tab allows another tab to restore and continue the draft.

For the compiled app-shell check, run `tests/e2e/local-offline-shell.spec.ts`
against a running local build preview with `PLAYWRIGHT_BUILT_UI=1`. The Windows
bundled WebKit engine currently raises an internal engine error on full offline
navigation, so that exact combination is skipped. Offline editing/reconnect is
still exercised there; real iOS offline reload remains a device release check.

Internet Explorer, legacy EdgeHTML, Android WebView shells that do not meet the Chrome floor, and embedded in-app browsers are not supported. Unsupported browsers should still receive the sign-in page where possible, but critical training/session behavior is not guaranteed.
