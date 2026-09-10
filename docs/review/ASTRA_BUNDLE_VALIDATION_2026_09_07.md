# Bundle and offline validation — 2026-09-07

The final production build passes the existing performance budgets. No budget, browser target, compressor safety setting, or runtime dependency was changed.

## Build changes

`vite.config.ts` keeps modules already required by the entry page in one compressed entry chunk. Comparing the generated static import graph before and after grouping found **86 modules in both, with no added or removed eager module**.

The program editor, authoring dialogs, and two program run wizards share one lazy `program-authoring` chunk. Related forms compress together while coaching, calendar, exercises, next workouts, and data persistence retain their own loading boundaries. Exact module groups use `includeDependenciesRecursively: false` so shared dependencies cannot pull the editor into startup.

The grouping alone reduced measured total JavaScript gzip from approximately 228.7 kB to 225.6 kB. Subsequent removal of production-unreachable demo branches and stylesheet consolidation completed the reduction. Data-module grouping and additional execution-order wrappers increased size and were rejected.

## Final production measurements

| Metric | Raw bytes | Gzip bytes | Existing raw / gzip limits |
| --- | ---: | ---: | ---: |
| Initial JavaScript | 424,602 | 120,923 | 460,000 / 130,000 |
| Largest async JavaScript | 165,980 | 44,519 | 180,000 / 45,000 |
| All JavaScript, including worker | 804,871 | 224,780 | 810,000 / 225,000 |
| CSS | 119,832 | 21,386 | 120,000 / 22,000 |

Measured with `scripts/check-performance-budgets.mjs` (gzip level 9). Machine-readable evidence is in `artifacts/astra-review/bundle-final-report.json`. Source revision metadata remains the current checkout's base revision; measurements include its working-tree changes.

## Browser validation

A built local preview on port 3012 used the local seeded Supabase accounts without resetting the database.

- Chromium, Firefox, and mobile WebKit: authentication → Next workouts → Programs → program run wizard → program detail, with no page exceptions or failed script responses.
- Chromium and mobile WebKit: create a program, add a workout and exercise, save metadata, reopen, verify contents, and remove the test-created program.
- Chromium and Firefox: installed worker control, edit offline, full offline reload, recover the exact note, reconnect and acknowledge the server save, then restore the original note.
- Independent two-release worker regression: Chromium, Firefox, and mobile Chromium preserve release A's document and previously unopened lazy code while release B waits; closing the last client and reopening offline activates release B and removes release A's cache.

Playwright's Firefox request interception causes `NS_ERROR_OFFLINE` before the worker receives an offline navigation, including when a route matcher excludes localhost. The permanent offline regression disables interception **after** disabling networking and reinstalls the external-destination guard **before** reconnecting. A separate no-interception probe confirmed the built app works offline in Firefox. Mobile WebKit still reports an internal engine error on offline reload without interception; that engine-specific automated test remains skipped and needs real-device confirmation.

Focused checks: TypeScript, ESLint for the build configuration and changed browser helpers, and unchanged production bundle gates. Browser artifacts and the reproducible smoke configuration are under `artifacts/astra-review/`; the permanent offline regression is `tests/e2e/local-offline-shell.spec.ts` and the release-upgrade regression is `tests/e2e/offline-release-upgrade.spec.ts`.
