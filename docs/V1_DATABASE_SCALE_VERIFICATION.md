# V1 local database scale verification

`npm run perf:database:local` verifies the V1 data architecture against the
currently running **local Supabase database only**. It does not connect to dev,
staging, or production. The runner rejects every database URL whose hostname is
not exactly `localhost`, `127.0.0.1`, or `::1`.

## Fixture and rollback model

The runner builds this deterministic fixture:

- one coach and 50 active athlete relationships;
- one immutable 10-week program containing 40 workouts, 120 sections, 320
  workout items, and 960 prescribed entries;
- 50 shared assignment rows that all reference the same published version;
- 150 completed sessions for each athlete (7,500 total), with one representative
  logged item and entry per session;
- 5,000 global exercises whose names exercise indexed prefix search.

All fixture writes, `ANALYZE` calls, mutation measurements, and read measurements
run on one connection inside one transaction. A successful run deliberately
rejects the transaction with a private rollback signal. An unsuccessful run is
rolled back by the database client. Before and after the transaction, deterministic
sentinel IDs are checked to prove that no fixture row survived.

To construct representative logs that are already completed, the owner-only
fixture loader temporarily disables the two result-history immutability triggers,
then re-enables them before measurement. Foreign keys and assignment/session
lineage guards remain enabled, and the trigger changes are covered by the same
rollback-only transaction.

## What is measured

Every measured operation uses:

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)
```

The report covers:

- assigning the published version to 50 athletes;
- creating one selected occurrence and replaying its idempotency key;
- bounded program list and one selected program detail;
- bounded schedulable candidates, calendar, and history pages;
- indexed exercise prefix search;
- bounded coach list and one selected athlete detail.

Wall-clock times are recorded for observation, not used as pass/fail gates. The
assertions target stable architecture contracts instead: result caps, one shared
assignment per athlete, zero cloned content rows, exactly one occurrence, zero
eager session rows, idempotent retries, read-only WAL, and conservative mutation
WAL amplification ceilings.

## Running it

Start and migrate local Supabase first:

```powershell
npm run db:start
npm run db:reset
npm run db:lint
npm run test:integration
npm run test:v1:database-smoke
npm run perf:database:local
```

The default database URL is
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`. A different local port
or database may be supplied through `LIFTLOG_LOCAL_SCALE_DB_URL`; the hostname is
still required to be loopback-only.

To keep the complete JSON plans and exact metrics, request the ignored artifact
explicitly:

```powershell
npm run perf:database:local:report
```

This creates `artifacts/performance/database-scale.json`. The CLI only accepts
`.json` output paths below `artifacts/`, and it creates no report by default.
CI runs the same deterministic sequence through `npm run ci:local-supabase`
before seeding the separate read-only browser performance fixture.

Run the safety guard tests without a database:

```powershell
node --test tests/database-scale-safety.test.mjs
```

## Interpreting a failure

- A connection refusal means local Supabase is not running.
- A missing-contract error means the latest V1 migration has not been applied to
  local Supabase.
- A result-cap failure indicates a public RPC stopped enforcing its server-side
  bound.
- A clone-amplification failure means ordinary assignment created program-tree
  rows and must not ship.
- A rollback-sentinel failure means a prior local run left deterministic fixture
  rows behind; inspect and reset only the disposable local database before retrying.

Execution time and buffer changes should be compared between reports, but a timing
change alone is not a correctness failure. Review the captured plan together with
fixture shape, returned rows, buffers, temp blocks, and WAL.
