# Windows Docker startup repair — 9 September 2026

The recurring failure was reproduced before the Linux engine initialized. Windows refused access to stale AF_UNIX socket files in Docker's temporary runtime directory. Docker Desktop 4.43.2 failed on `dockerInference`; an official upgrade to 4.90.0 did not fully resolve it on this host. A normal stop followed by an ordinary launch still failed on `sailor-ingest.sock`.

## Repair

- Verified the Docker Inc. installer signature and official SHA-256 checksum before updating the existing all-users installation to 4.90.0.238679 (Engine 29.7.2).
- Added a guarded standalone PowerShell launcher. While Desktop is fully stopped, it validates and preserves the two known socket directories under new sibling names, creates empty replacements, and starts Desktop. It rejects linked directories and unexpected data; it never resets Docker, removes volumes or touches virtual disks.
- Routed `npm run db:start` and `npm run dev:local` through local-endpoint validation, guarded Windows startup and bounded Linux-engine readiness checks.
- Installed the same launcher at `%LOCALAPPDATA%\DockerStartup\start-docker-desktop.ps1` and wired the user's Desktop and Start Menu Docker Desktop shortcuts to it. Shortcut failures display an actionable error. The repository launcher remains the source copy.

Docker's original executable and `docker desktop start` bypass the guard. The fix covers the reproduced Windows socket failure through the supplied launch paths; unrelated Docker, WSL or hardware failures still require diagnosis.

## Data protection

Before the upgrade, with Docker and WSL stopped, copied the data disk, engine disk and settings to `C:\Users\toyur\AppData\Local\DockerRepair\20260909-013740`. The 28,273,803,264-byte data disk copy matched the source SHA-256 `954BF13DCC8086BF5DD1BE6B009F40A841C46E208662F8C02EBB61146FD744C4`.

No database reset, reseed, WSL unregister, prune or volume deletion occurred. Existing database, storage and Edge Runtime volumes were retained.

## Verification

- Three consecutive guarded cold starts succeeded: standalone launcher, installed Desktop shortcut, and project Node helper. Normal Desktop stops were used between successful launches.
- The initial three guarded launches retained 9 users, 84 recorded migrations, 17 programs and 10 workout sessions. Existing container IDs were retained.
- Rechecking an already healthy engine performed no runtime-folder moves.
- `npm run db:start` exited successfully against the existing database.
- All 22 startup tests passed, including eight actual PowerShell filesystem tests covering preservation, unknown-data rejection, linked paths and running-process protection.

The final complete cold `npm run db:start` exited 0 after explicitly waiting for the existing database health check, restoring the same Edge Runtime container and checking Vector. Vector reported healthy with zero restarts; Edge Runtime was running. The database retained 9 users, 84 migrations, 9 visible programs and 10 sessions. Browser authoring checks created and then archived two additional test programs through the normal UI, bringing total program rows to 19; no original data was removed.

This end-to-end test exposed Supabase's native CLI emitting its temporary database-starting error as plain text even with JSON output requested. The project now recognizes that exact diagnostic as well as the structured form, and waits for the verified existing database before invoking the CLI. Thirteen focused startup tests cover transient/plain-text responses, bounded deadlines, nontransient errors, project identity and Edge Runtime recovery. Together with launcher and Vector checks, all 44 startup checks pass.

The separate Supabase Vector logging connection was also found restarting because its Windows configuration targeted an unavailable Docker TCP listener. The project startup now checks and, when necessary, replaces only Vector with the same generated configuration and a private Linux socket connection. The live replacement reached stable healthy status. Nine additional tests cover project/endpoint guards, failed probes, concurrency, rollback, lost rename responses and idempotence. Docker TCP port 2375 remains closed; analytics stays enabled.

Sources: [Docker release notes](https://docs.docker.com/desktop/release-notes/#4900), [reported Windows socket failure](https://github.com/docker/desktop-feedback/issues/460), [Docker backup guidance](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/).
