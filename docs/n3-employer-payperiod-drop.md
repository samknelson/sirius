# N3 Ruling — `sirius_employer_payperiod` DROPs (nothing migrates)

**Status: CLOSED 2026-08-06.** Sanitized tracked record of the N3 ruling. Aggregates only —
no production row values. The record-level evidence appendix (per-nid checks, raw query
output) stays in the untracked local `docs/s1-migration/` set (06-strategy-revision v5.2 §8,
02-mapping §13a, 05-open-questions N3, 07-prod-query-pack §N).

## Ruling

`sirius_employer_payperiod` (18,422 nodes at ruling time) does **not** migrate to S2.
It is dropped entirely, with an explicit, counted, named pipeline skip — never a silent drop.

## What the bundle is

Production evidence (2026-08-05/06) identifies it as the sirius_hour **"epayperiod"
employer hours-reporting workflow tracker**:

- **Auto-created on demand** by `sirius_hour_epayperiod_load(..., $create_active)` —
  a get-or-create helper, not operator data entry.
- **UI surface:** only `sirius/hour/payperiod/all|mine|requested`.
- **Shape:** employer ref + `date_start`/`date_end` + `datetime`/`datetime_completed` +
  `active` + `domain`. No hours amounts, no JSON payload.

## Evidence summary (all aggregates)

| Check | Result |
|---|---|
| Row count | 18,422 |
| Period shape | 100% calendar-month envelopes (start = first of month, end = last of month) |
| Workflow state | 100% completed |
| Inbound references | **0** — verified across every `field_data_%_target_id` table |
| Duplicates | occasional (employer, month) pairs — concurrent get-or-create races |
| Write activity | still written daily (auto-created during hours reporting) |

## Why DROP (and not map to `wizard_employer_monthly`)

S2's `wizard_employer_monthly` recreates equivalent workflow state per hours import — the
migrated `sirius_payperiod` hours themselves prove which employer-months were reported.
Backfilling `wizard_employer_monthly` from S1 history was **rejected**: it would require
synthesizing ~18k parent `wizards` rows solely to restate facts the migrated hours already
carry. Zero inbound references mean nothing else in S1 depends on these nodes.

## Count-accounting contract (pipeline skip)

`scripts/s1-migration/stage.ts` lists the bundle in `DOCUMENTED_SKIP_BUNDLES` with reason
**`employer_payperiod_workflow_state`** (same documented-skip pattern as N18's
`legacy_json_format`):

- The bundle is excluded in **every** invocation mode — default, `--all`, and explicit
  `--bundles` requests.
- Every run logs `sirius_employer_payperiod: DOCUMENTED SKIP reason=… s1=<count>` with the
  live S1 node count, and the skip (bundle, reason, count) is persisted in the staging run
  record, so the production run report accounts for every row.
- No loader consumes the bundle, so no loader verify step can flag the skipped rows as
  FATAL.

## Cutover freeze interaction

The bundle **stays on the freeze-window writer list** (06 §4.17): it is written daily, and
the freeze must stop those writes with everything else. Rows created between profiling and
the freeze snapshot are **expected** — they are also dropped, and the logged skip count in
the prod run simply reflects the larger total.

## Out of scope

- Any backfill of `wizard_employer_monthly` from S1 history (rejected above).
- Other open N-items (N4, N7, N19–N23, OPEN-1).
