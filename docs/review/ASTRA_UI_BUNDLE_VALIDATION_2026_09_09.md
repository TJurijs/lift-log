# UI consistency bundle validation — 9 September 2026

The consistency changes retain the existing production size limits. The final grouping in `vite.config.ts` reduced total JavaScript gzip from 225,794 to **224,706 bytes**, including the service worker. No features, dependencies, browser targets, or compressor settings changed.

## Loading boundaries

The entry group claims its existing eager dependencies first. The repository and workout-persistence groups then retain their own static dependencies. The workspace group combines its remaining static dependencies, including the shared UI vocabulary and icons, into one compressed response. Catalog filter utilities remain separate to keep the workspace response within its existing limit. The date-generation helper joins the already shared lazy authoring group.

The priority order is explicit because recursively collecting workspace dependencies without first preserving the data boundaries would change what gets loaded together. Dynamic feature imports remain in place.

An exact comparison of emitted module sets before and after grouping found **no added or removed statically loaded module** for any checked entry:

| Entry or feature | Modules before / after |
| --- | ---: |
| Initial application | 86 / 86 |
| Workspace | 153 / 153 |
| Repository | 92 / 92 |
| Workout persistence | 101 / 101 |
| Authoring dialogs and each program wizard | 162 / 162 |
| Calendar | 155 / 155 |
| Coaching | 157 / 157 |
| Exercises | 154 / 154 |
| Next workouts | 154 / 154 |

## Production measurements

| Metric | Raw bytes | Gzip bytes | Existing raw / gzip limits |
| --- | ---: | ---: | ---: |
| Initial JavaScript | 424,749 | 120,943 | 460,000 / 130,000 |
| Largest async JavaScript | 166,225 | 44,848 | 180,000 / 45,000 |
| All JavaScript including worker | 804,015 | 224,706 | 810,000 / 225,000 |
| CSS | 119,193 | 21,295 | 120,000 / 22,000 |

The total-JavaScript margin is 294 gzip bytes and the largest-async margin is 152 gzip bytes. Future changes must continue to run the size gate.

Validation completed: isolated production build, unchanged bundle gate, TypeScript, and ESLint for the build configuration. Chromium, Firefox, and mobile WebKit each passed a read-only built-local journey through authentication, all five main destinations, opening the program-use wizard, and opening/returning from program detail. No page exceptions or failed script responses occurred. The first browser attempt could not authenticate while the local Docker API was restarting; all three passed after the API returned healthy.

Reproducible experiment and measurement artifacts are under `artifacts/astra-review/`: `measure-ui-chunks.mjs`, `compare-ui-chunks.mjs`, `ui-bundle-production-report.json`, `ui-bundle-module-comparison.json`, and `ui-chunk-smoke.config.ts`. All experiments used separate output directories and did not overwrite the main local preview build.
