# Local development and Docker startup

For everyday local development, run `npm run dev:local`. For dependencies only, run `npm run db:start`.

These commands validate the local Docker target, start Docker Desktop when required on Windows, wait for a healthy Linux engine, and start the existing Supabase stack. Hosted Docker endpoints are rejected. They do not change Docker context, reset the database, prune volumes or seed replacement data.

Supabase startup retries the specific temporary database `starting` health state for up to 120 seconds. Other failures stop with a diagnostic. The enabled Edge Runtime is also restored from its existing container when Docker shutdown has stopped it. Local keys and generated container configuration stay out of startup output.

The demo and local database modes use separate Vite dependency caches, so running both previews does not invalidate React's optimized assets in the other server.

## Windows startup recovery

Use the supplied guarded Windows launcher through these commands. Windows can leave inaccessible AF_UNIX socket files after Docker exits. On this machine the failure recurred with Docker Desktop 4.43.2 and after updating to 4.90.0, including after a normal Desktop stop. The error names `dockerInference` or `sailor-ingest.sock` and says that the file cannot be accessed by the system.

This workstation's Desktop and per-user Start Menu **Docker Desktop** shortcuts also use the launcher. Its standalone copy is `%LOCALAPPDATA%\DockerStartup\start-docker-desktop.ps1`, so the shortcuts keep working if this repository moves. Directly opening the vendor executable or using `docker desktop start` bypasses this preparation and can still reproduce the Windows socket failure. After changing the repository launcher, update the installed copy too.

The launcher prepares only recognized temporary socket directories while Docker is fully stopped. It preserves stale files under a new sibling directory name and starts Desktop hidden. It never modifies the Docker virtual disk, container volumes, settings or authentication data. Unknown files or linked directories cause an actionable error rather than an automatic repair. Concurrent launches are serialized.

If Docker is already running, the launcher leaves its runtime files intact. If Desktop is displaying a startup error, quit the failed Desktop instance before retrying. For a healthy engine, repeated `npm run db:start` calls reuse it.

The Node readiness check has a total timeout of 120 seconds and bounded individual commands. A timeout should be investigated using Docker's current startup error; it does not trigger a database reset. Linux and macOS require their local Docker service or Desktop to be running.

## Local service logging on Windows

Supabase's Windows CLI configures Vector to collect logs through Docker TCP port 2375. This workstation keeps that unauthenticated listener disabled. After Supabase starts, `db:start` checks only this project's Vector container and connects it through Docker's private Linux socket when necessary. The generated logging configuration, image, network and restart policy are preserved. The original container remains available for rollback until the replacement stays healthy.

This check is idempotent and also repairs Vector after a Supabase CLI recreation. Unexpected project identity, host mounts or configuration cause a diagnostic instead of a replacement. The database and other application services are unaffected. `node scripts/ensure-local-vector.mjs --check` inspects the current configuration without starting or modifying containers. The socket is available only inside the logging container; its read-only mount does not restrict the Docker API itself.

## Data preservation

`npm run db:stop` stops the project's Supabase stack while keeping its data. `docker desktop stop` stops Docker Desktop. Use `npm run db:start` or `npm run dev:local` to return to work on Windows.

`npm run db:reset` is an explicit fixture rebuild. Use it only when the local database is intended to be replaced. It is unnecessary for ordinary startup, UI review, or the Windows socket failure.

The September 9 host repair also made a verified offline copy of the Docker data disk and settings beneath `%LOCALAPPDATA%\DockerRepair`. This backup is local to the workstation and is not committed to the repository.

Docker's [release notes](https://docs.docker.com/desktop/release-notes/#4900) describe a stale-socket startup fix. The remaining Windows failure is also described in [Docker issue 460](https://github.com/docker/desktop-feedback/issues/460). The guarded launcher addresses the reproduced startup problem on this workstation; it does not promise recovery from unrelated hardware, disk, WSL or Docker failures.
