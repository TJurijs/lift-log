# Phase 3 hosted-development read-only performance baseline

Measured at `2026-08-24T14:53:04.422Z` with:

```text
node scripts/measure-hosted-readonly-performance.mjs --iterations=9
```

The app ran at loopback `localhost` using the hosted-development build and the audited development Supabase project. The browser was headless Chromium at 1440 × 900 with service workers blocked. Each warm screen has nine samples. `Ready` ends when the semantic screen target is visible; `settled` additionally waits until Data API traffic has been idle for 400 ms, so settled durations include that deliberate quiet window.

## Safety result

- Navigation and coaching-workspace tabs were the only application controls used.
- The harness allowed `GET`/`HEAD` Data API reads and the two audited list RPCs (`list_pending_coach_invites` and `list_outgoing_coach_invites`). It blocked every other Data API method.
- Data API write attempts: **0**.
- Production or unaudited Supabase requests: **0**.
- Data API HTTP/transport failures: **0**.
- Page errors / console errors: **0 / 0** for both personas.
- No password, token, API key, request header, body, query parameter, or account ID is emitted.
- A negative guard check against `https://app.liftlog.cc` refused to start before opening a browser.

## Authenticated bootstrap

Bootstrap is one sign-in sample per fictional persona, measured from persona selection until the default Next-workouts screen is ready and then network-settled.

| Persona | Ready ms | Settled ms | Data API requests | Peak concurrency | Content bytes | Cards / rows | Document height px | JS heap bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jānis Čakste | 1,373.92 | 1,775.21 | 22 | 12 | 70,040 | 2 / 0 | 900 | 16,154,560 |
| Raimonds Vējonis | 1,350.99 | 1,605.80 | 29 | 12 | 72,343 | 2 / 0 | 900 | 16,180,624 |

## Warm navigation

Request and content-byte columns are median / p95. DOM counts and height are stable medians. Heap is Chromium `JSHeapUsedSize` median / p95.

| Persona / screen | Ready ms median / p95 | Settled ms median / p95 | Data requests median / p95 | Content bytes median / p95 | Cards / rows / panels | Height px | Heap bytes median / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jānis · Next workouts | 40.99 / 44.18 | 421.28 / 438.32 | 0 / 0 | 0 / 0 | 2 / 0 / 2 | 900 | 18,370,452 / 21,581,732 |
| Jānis · Programs | 41.67 / 58.28 | 420.74 / 428.56 | 0 / 0 | 0 / 0 | 5 / 5 / 6 | 937 | 20,552,184 / 22,275,620 |
| Jānis · Calendar | 39.64 / 53.79 | 420.01 / 428.60 | 0 / 0 | 0 / 0 | 1 / 0 / 4 | 984 | 20,514,736 / 28,913,308 |
| Jānis · Exercise library | 75.00 / 85.51 | 413.43 / 417.49 | 0 / 0 | 0 / 0 | 0 / 144 / 2 | 7,289 | 25,420,332 / 31,157,392 |
| Raimonds · Coaching / My coaches | 41.60 / 54.19 | 1,112.49 / 1,384.72 | 29 / 29 | 72,343 / 72,343 | 0 / 1 / 1 | 900 | 18,646,220 / 22,731,252 |
| Raimonds · Coaching / My athletes | 851.66 / 864.68 | 1,086.30 / 1,216.84 | 29 / 29 | 72,343 / 72,343 | 1 / 5 / 5 | 900 | 20,634,008 / 27,799,616 |

`Content bytes` are Playwright response-body bytes and were available for every Data API response. Transfer size was available from `Content-Length` for only 4 of 22 Jānis bootstrap responses and 3 of 29 Raimonds/coaching responses (8 and 6 bytes respectively), so header-derived transfer totals are incomplete and should not be compared as payload totals.

DOM cards/rows are rendered-element counts from stable application selectors, not database row counts. The card set includes program, workout, calendar, and coach-program cards; the row set includes exercise, coach connection, athlete, agenda, compact-program, workout-list, table, and ARIA rows.

## Findings bounded by this fixture

1. The starting bootstrap budget of at most six Data API calls is not met: Jānis performs 22 and Raimonds 29, with peak concurrency 12.
2. Jānis's warm core views make no screen-specific reads because their full data shapes were already fetched during bootstrap. Their fast ready times therefore characterize the current monolithic preload, not screen-oriented data ownership.
3. Entering Raimonds's Coaching screen and switching to My athletes each reload the same 29-request, 72,343-byte workspace graph. My athletes misses the proposed 500 ms cached-navigation budget at 864.68 ms p95; the My-coaches panel paints quickly but its refresh settles at 1,384.72 ms p95.
4. The Exercise library renders 144 rows into a 7,289 px document and has the largest measured warm-screen heap (31,157,392 bytes p95). This supports paging/windowing and lazy-loading work before the 5,000-exercise scale fixture.
5. These numbers describe the nine-person hosted-development fixture. They do not replace the required local 999/1,000/1,001/5,000-row correctness tests or the 10/100/250-athlete scale measurements.
