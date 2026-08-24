# Phase 3 hosted-development read-only performance after scoped coaching

Measured on 2026-08-24 with the same hosted-development, read-only Chromium harness documented in the [Phase 3 baseline](hosted-readonly-performance-baseline.md):

```text
node scripts/measure-hosted-readonly-performance.mjs --iterations=9
```

Each warm coaching flow has nine iterations. `Ready` ends when the semantic screen target is visible; `settled` additionally includes the harness's 400 ms Data API quiet window.

## Earlier author-scoping result

| Raimonds coaching flow | Data API requests p95 | Content bytes p95 | Ready p95 | Settled p95 |
| --- | ---: | ---: | ---: | ---: |
| My coaches — baseline | 29 | 72,343 | 54.19 ms | 1,384.72 ms |
| My coaches — after author scoping | **0** | **0** | **48.36 ms** | **420.80 ms** |
| My athletes — baseline | 29 | 72,343 | 864.68 ms | 1,216.84 ms |
| My athletes — after author scoping, before migration 008 | **0** | **0** | **57.47 ms** | **425.19 ms** |

The author-scoping change removed the repeated full-workspace request graph from both warm coaching navigations. At that milestone, My-athletes ready p95 fell by 807.21 ms and settled p95 fell by 791.65 ms; My-coaches settled p95 fell by 963.92 ms. These rows remain useful as the pre-migration-008 comparison, but they are not the final deployed read shape.

## Final post-migration-008 measurement

The final hosted-development rerun completed at `2026-08-24T18:10:14.387Z`, after migrations `202608240001` through `202608240008` and the compatible frontend release were live.

### Authenticated bootstrap

| Persona | Pre-008 requests | Pre-008 content bytes | Final requests | Final content bytes | Final ready |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jānis | 22 | 70,040 | **22** | **71,252** | **2,414.89 ms** |
| Raimonds | 29 | 73,813 | **22** | **67,728** | **1,892.08 ms** |

Migration 008 removes seven bootstrap requests for the coach persona and reduces its response content by 6,085 bytes. The global bootstrap remains at 22 requests for both measured personas, so the approved six-call target is still open.

### Warm coaching navigation

| Raimonds coaching flow | Data API requests p95 | Content bytes p95 | Ready p95 | Settled p95 |
| --- | ---: | ---: | ---: | ---: |
| My coaches — final | **0** | **0** | **56.43 ms** | **426.69 ms** |
| My athletes — final | **1** | **1,546** | **58.98 ms** | **1,418.89 ms** |

My coaches requires no navigation-time Data API request. My athletes now loads only the selected athlete's bounded detail on demand; that single detail request is cached, so its median request count is zero even though p95 captures one request. The higher My-athletes settled p95 reflects that bounded lazy fetch rather than a return to the former full-workspace fan-out.

## Safety, rollout, and remaining limits

- The final harness run recorded **zero writes**, **zero bad-origin requests**, **zero HTTP or transport failures**, **zero page errors**, and **zero console errors**.
- Migrations through `202608240008` and the compatible release are live only in hosted development. Production is explicitly untouched; this work performed no production deployment or production-data modification.
- The remaining P1 capacity gates are the global six-call bootstrap and maximum-cardinality evidence with authenticated query plans. This warm read-only result does not close either gate.
- Real-device offline, reconnect, and background/recovery validation remains separate from this hosted Chromium measurement.

## Active nonproduction bundle

The active hosted-development nonproduction build continues to lazy-load the authenticated product shell:

| Nonproduction asset | Phase 0 | Active release | Change |
| --- | ---: | ---: | ---: |
| Initial entry, minified | 663.56 kB | **479.85 kB** | -27.7% |
| Initial entry, gzip | 181.56 kB | **135.73 kB** | -25.2% |
| Authenticated lazy chunk, minified / gzip | n/a | **202.63 / 52.99 kB** | split from entry |
| Total app JS, minified / gzip | 663.56 / 181.56 kB | **682.48 / 188.72 kB** | +2.9% / +3.9% |
| CSS, minified / gzip | n/a | **99.87 / 18.52 kB** | recorded for non-regression |

The oversized-single-chunk warning is gone and unauthenticated/bootstrap delivery is materially smaller. Signed-in total JavaScript is slightly above baseline, so further feature-level splitting remains a release-performance follow-up rather than being reported as complete.
