# Hosted development rollout — 2026-08-24

## Scope and final state

- Target: hosted development project `ofyeejyfroblunbspgve` and `dev.liftlog.cc`.
- Production was not deployed to and production data was not modified.
- Development migrations are synchronized through `202608240008_bounded_coach_workspace_overview.sql`.
- Active frontend release: `20260824T180133Z`.
- Previous rollback release: `20260823T232214Z`.
- Active application asset: `index-ChY17FGD.js`, SHA-256 `fc037975294a3995730bb7c164e0e96305498b5687a89e94ce12b91680284b6d`; the asset returned HTTP 200.

## Recovered rollout failures

- The first frontend transfer produced Windows/SCP mode `0700`; nginx returned 404. The release was rolled back successfully before permissions and publishing were corrected.
- A migration attempt encountered SQLSTATE `40001`, was retried, and then returned HTTP 504. The development database was rolled back successfully before retrying the coordinated rollout.
- The first hosted integration run retained a stale expectation that authenticated clients could write session result tables directly. The test was corrected to the revisioned RPC contract; application authorization was not weakened.
- Migration 007 was corrected for the PostgREST `PT409` conflict response before the final migration sequence was applied.

## Final validation evidence

| Gate | Result |
| --- | --- |
| Hosted integration | Passed in approximately 25.94 s |
| Database lint | Clean |
| Migration state | Local and hosted development migrations synchronized through 008 |
| Signed-in smoke | Passed on desktop and at 390 × 844 |
| Frontend asset | `index-ChY17FGD.js`; SHA-256 `fc037975294a3995730bb7c164e0e96305498b5687a89e94ce12b91680284b6d`; HTTP 200 |

Read-only hosted performance observations:

| Persona / surface | Requests | Ready duration | Response bytes |
| --- | ---: | ---: | ---: |
| Jānis | 22 | 2414.89 ms | 71,252 B |
| Raimonds | 22 | 1892.08 ms | 67,728 B |
| My athletes | p95: 1 | p95: 1418.89 ms | 1,546 B |

## Remaining P1 evidence gaps

- The default authenticated bootstrap still exceeds the approved six-call budget: both measured personas issued 22 requests.
- Hosted maximum-cardinality tests and authenticated query-plan evidence remain open for the approved program, athlete, occurrence, session, exercise, and 52-week-tree bounds.

## Rollback

If smoke validation fails, restore the previous frontend release `20260823T232214Z` and run the transactional development read-compatibility procedure in [`restore_pre_author_scope_read_compatibility.sql`](../../../../supabase/dev-rollbacks/restore_pre_author_scope_read_compatibility.sql). Re-run migration synchronization, database lint, hosted integration, asset HTTP, and signed-in smoke checks after either rollback or recovery.
