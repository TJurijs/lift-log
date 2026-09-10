# Custom exercise videos — local implementation, 10 September 2026

Status: implemented locally. No push or hosted deployment has been performed.

## Behavior

- The custom exercise editor accepts up to ten ordered video links, each with an optional label. Add and remove controls retain unsaved input after validation or server errors. Existing single links appear in the editor; removing every row explicitly clears the links.
- Multiple videos have individual labeled play controls. The workout places them beneath its heading so the exercise name, targets and instructions retain room on mobile. Library cards, exercise details, workout pickers, planned workouts and completed history share the video renderer.
- YouTube custom links open the embedded player from the beginning with controls and fullscreen available. Other HTTP(S) links open externally. Legacy catalog videos retain the existing seven-second muted demonstration behavior until explicitly edited as a custom list.
- Shared client validation and database validation reject unsafe URLs, embedded credentials, excessive lengths and oversized lists. Duplicate URLs are reduced to their first entry, preserving labels and order. Explicit empty arrays clear media; missing/null arrays use the legacy single URL.
- The local **Power clean + push jerk** example has separately labeled Power clean and Push jerk demonstrations from the corresponding existing catalog records. Its four sets and full 2+1 instructions remain intact.

## Persistence

Migration `202609100004_multiple_exercise_video_links` adds nullable exercise `video_links` and session `snapshot_video_links`. A custom list maintains the legacy `video_url` as its first URL. Untouched single-video records retain null lists and their existing playback behavior.

The migration extends bounded search, program, workout, run and coaching projections. Starting a session captures its video list; active workout restoration and completed history use that snapshot. Editing the library cannot replace media in an existing session. Existing historical data is not rewritten. The exercise editor invalidates dependent planned-content caches when videos change.

All 88 migrations are applied locally, with none pending. The new SQL smoke runner is available as `npm run test:videos:database-smoke` and included in the dedicated local database CI workflow. No database reset was used for this work.

## Preview

- Desktop: <http://127.0.0.1:3001/?example=recording#/today>
- Mobile: <http://127.0.0.1:3001/?example=recording&preview=mobile>

Enter the local demo and start **Strength + core**. Under **Power clean + push jerk**, select either labeled play button. To edit its links, open **Exercises → My exercises**, then edit the combined exercise. This example is in memory and resets on reload; the same editor persists links in the database-backed app.

## Validation and performance

The database checks cover ordered/cleared/legacy links, validation, access control, snapshots, planned and coached projections, session resume, edits after completion and unchanged existing-row hashes. Full local Supabase integration and portable migration checks pass.

All 690 behavior tests and 262 legacy checks pass (one integration-runner skip), along with TypeScript, ESLint, production build and bundle gates. Regression coverage includes pending planned-content cache loads, clearing all videos, preserving history caches, keyboard focus, closing during player loading, and reopening playback. Desktop verification removed and re-added the Push jerk link, saved it, and opened the correct YouTube demonstration; mobile verification checked full-width play controls alongside the complete instructions.

The feature adds URL validation, an editor and session-media plumbing. Its first production build measured 811,715 raw / 225,810 gzip JavaScript bytes, versus 807,981 / 224,583 before the feature. The total budget was reviewed and adjusted to 815,000 raw / 227,000 gzip bytes. Initial-load, largest-chunk, CSS and runtime ceilings remain unchanged; this is feature growth rather than leaked development fixtures. Final build and test results are recorded in `artifacts/exercise-review/videos-*.log` and `videos-bundle.json`.

The video player and optional YouTube API now load only after opening a demonstration, while the dialog shell, close button and focus handling appear immediately. Final JavaScript totals are 812,198 raw / 226,319 gzip bytes, with the workspace chunk at 44,506 gzip bytes and CSS at 119,996 raw / 21,455 gzip bytes.
