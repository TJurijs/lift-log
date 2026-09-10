# Reviewed development template update

This is an operational update to one reviewed personal template, not a schema migration or a catalog-wide change. The executable refuses every database except development project `ofyeejyfroblunbspgve`. Do not run it against production. It requires migration `202609100005`, which protects timed entries from older cached clients, and a verified development database backup before application.

The private reviewed plan is intentionally ignored by Git because it contains personal workout content and identifiers:

```text
artifacts/dev-release-20260910-recording/complex-template-plan.json
SHA-256: deb73d186dc93cd18cfa7cb06f5963d50661a5ab5daf7336e72783f64a19a7da
```

The SHA is computed from canonical JSON by `templatePlanHash`, not the file's whitespace. Preserve this plan and the neighboring backup/report artifacts; do not regenerate it during a retry. Any change to the plan requires another review and rehearsal.

The reviewed draft has 26 items. The result has 24:

| Workout | Reviewed change |
| --- | --- |
| Day 1 — Snatch | Four Side plank holds become four Time sets of 30 seconds. Preserve the left/right instructions, 30-second rest, RPE 7 and original entry identities. |
| Day 2 — Jerk | Combine the paired Power clean and Push jerk rows into four sets of three total reps: two power cleans, then one push jerk. Preserve the earlier standalone two sets of two jerks. |
| Day 3 — Mixed | Combine the paired Clean and Push jerk rows into three sets of two total reps: one clean, then one push jerk. |

Both complexes retain the same-bar/load instruction, RPE 6–7 and 2–3-minute rest. Each receives a personal exercise with two labeled videos from the existing catalog. All other draft rows, published content, existing schedules, active/completed sessions and unrelated personal exercises must remain unchanged.

The existing published v1 and unedited draft v2 were compared by workout/item position, names, source exercise, notes, recording mode/fields and all prescription values; they are semantically identical before this operation. Version/item IDs and creation timestamps naturally differ.

## Rehearse and inspect

Use the existing local database, with all five recording migrations applied. The rehearsal creates a temporary owner and copies the reviewed content into fixtures inside one transaction. It checks drift refusal, protection of scheduled/published content, conflicting custom exercises, idempotency, retained history and future scheduling, then rolls everything back. It never resets a database or accepts a hosted connection.

```powershell
node tests/rehearse-dev-complex-template.mjs --plan=artifacts/dev-release-20260910-recording/complex-template-plan.json
```

Set `LIFTLOG_TEMPLATE_DATABASE_URL` in the operator environment to the development direct connection or session pooler on port 5432, with TLS. Obtain credentials through the existing secret mechanism; do not print or commit them. Without `--apply`, inspection uses a read-only transaction:

```powershell
node scripts/update-dev-complex-template.mjs --project-ref=ofyeejyfroblunbspgve --plan=artifacts/dev-release-20260910-recording/complex-template-plan.json
```

After schema promotion, verified backup, successful rehearsal and approval of this exact plan, apply once:

```powershell
node scripts/update-dev-complex-template.mjs --project-ref=ofyeejyfroblunbspgve --plan=artifacts/dev-release-20260910-recording/complex-template-plan.json --apply --expected-plan-sha=deb73d186dc93cd18cfa7cb06f5963d50661a5ab5daf7336e72783f64a19a7da
```

Application runs in a serializable transaction with an advisory lock. It checks the exact program owner/title/draft version, absence of schedules/sessions on that draft, catalog video identities, complete before/after content and unrelated content. Any drift aborts the whole transaction. A repeat returns `already-applied` only when the complete expected result and personal exercise definitions still match. Re-run read-only inspection afterward and retain its output with the private release evidence.

## When the changes take effect

No separate publish call is needed. `create_program_runs` uses `private.snapshot_program_for_run`, which freezes the latest working draft for a new run and creates a successor draft. Thus the next new run from the reusable template consumes these corrections automatically. Existing schedules and sessions remain attached to their old version. Repeating an existing run intentionally repeats that run's immutable snapshot; start a new run from the library template to use the revised content.

Do not manually publish v2 as part of this operation. The application performs publication atomically when the user creates a new run.
