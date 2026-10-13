# Dependent Linked benefits: inspect and approve before repairing scans

## Diagnosis

Read-only investigation of the test case labeled **Worker 50 / Child 50**
found an election selecting **MLK** and **Unite Here Dental Center** and only
those child benefits in January–October 2026 coverage. The scanner's blanket
election-benefit check prevented unelected Linked benefits from reaching their
configured rules.

The saved November global run did include the child. Both elected benefits
failed Ageout: **26 years 1 month**, above the maximum of **26 years**.
They were failed **starts**, with `action: none`, because November completed
before the newer October dependent grants. That snapshot had no previous-month
child coverage. There was no confirmed November termination event. Do not
interpret that as a skipped child, a passing Ageout check, or a deleted row.

The correction lets configured Election rules require selection and configured
Linked rules use the dependent's same-run, same-source effective coverage.
It does not change age limits, age calculation, election contents, or historical
inferred-termination ownership.

## Inspection only — no coverage writes

1. Confirm the environment is the affected **test environment**, not production.
   Resolve the worker and relationship using staff search; labels/Sirius IDs are
   not database IDs. Verify subscriber direction, relationship dates, elected
   relationship membership, as-of employer/policy, and each benefit's configured
   start/continue rules.
2. Save the existing October and November queue details/JSON, including completion
   stamps, dependent `people`, source relationship IDs, actions, rule reasons,
   and any execution errors. Record exact current/previous coverage and confirmed
   versus coverage-inferred events. Keep these snapshots in the approved
   operator record, not Git.
3. Bound the impact to the approved subscriber(s), dependent source(s), benefit
   rules and months. Compare policy Linked benefits against what was granted.
   Do not widen a one-family repair into an employer/global batch.
4. Use the existing worker **Benefits Scan**, **Test** mode for October 2026
   (`POST /api/workers/:id/benefits/scan`,
   `{"month":10,"year":2026,"mode":"test"}`) to preview all evaluated people and
   proposed creates/deletes. Preview November as well, but record that this
   preview reads today's persisted October coverage: it does **not** simulate
   the October preview's proposed writes.
5. Check `people[].error` and `actions[].executionError` as well as eligibility.
   A failed eligibility rule can be a successful scan execution. Any execution
   failure, unexpected ownership, unresolved policy, unexpected billing impact,
   or ambiguous relationship is a stop condition.

## Approval boundary

Get explicit approval naming the environment, subscriber database IDs, October
then November 2026, allowed coverage changes, and expected side effects.
Queue processing uses live writes even in a test deployment. WMB changes can
trigger charges, audit, event processing, and downstream listeners. This
document does **not** authorize billing repair, COBRA creation/reconciliation,
production scans, automatic follow-up scans, or global invalidation.

Check pending/in-flight scans and coordinate a quiet approved processing window.
If an isolated bounded drain cannot be guaranteed using existing controls,
stop and obtain an operator-approved method. Do not press **Process batch**:
it drains the shared queue and may execute unrelated work.

## Approved chronological rescan

1. Enqueue **only October** for the approved subscriber using the existing
   single-worker mechanism
   (`POST /api/wmb-scan/enqueue-worker/:workerId`,
   `{"month":10,"year":2026}`). Preserve the old snapshots first: rerunning
   replaces the relevant saved queue result, it is not an append-only history.
   Let the approved existing queue processor handle that job; do not enqueue
   November concurrently. Monitor the worker's exact job until completed.
2. Verify October dependent coverage has the elected medical/dental benefits
   and expected Linked benefits/chains; every created row retains the approved
   source relationship and subscriber employer. Other-source and independent
   benefits must remain unchanged. Check saved dependent names and plugin results.
3. Preview November again in **Test** mode, now against committed October
   coverage. Expect failed **continuations** for the prior-month child benefits:
   elected benefits fail Ageout, Linked benefits fail when their dependent
   source coverage fails, even if the subscriber still has medical coverage.
4. Only after those checks pass, enqueue **November** for the same subscriber.
   Wait for completion and inspect the saved result. `action: none` with
   `scanType: continue`, `eligible: false`, and no execution error is valid
   failed-continuation evidence even if no November row existed to delete.
5. Verify the normal per-worker completion/`trust-wmb-terminate` path produced
   confirmed November events for the dependent with the expected failed plugin
   reasons. Check denorm status; a stale row is pending processing, not proof of
   a completed event. Confirm current coverage is absent for terminated benefits;
   coverage through any other source suppresses a worker-level termination event.
6. Compare before/after coverage, saved outcomes, events, and any approved
   side effects. Stop if outcomes differ. Do not edit results/events directly,
   reinterpret the old November failed-start snapshot as a continuation, or
   alter elections to include Linked benefits.

Standalone **Live** worker scans write coverage but do not record queue results
or run the queue-completion termination handoff. They are **not** a substitute
for this saved-result repair. Existing aggregate month counters are historical;
this change does not rewrite old counters or old November snapshots.

## Regression verification (isolated fixtures)

- `WMB_QUEUE_STORAGE_PG=1 npx vitest run tests/wmb/dependent-linked-outcomes.test.ts tests/wmb/benefits-scan-dependent.test.ts tests/wmb/scan-outcome-counts.test.ts`
  exercises real Election/Linked/Ageout and scanner logic, October→November and
  reversed order, real queue-summary/event persistence in a disposable PostgreSQL
  cluster, source isolation, and no-delete continuation counts.
- `node tests/wmb/outcomes-browser.mjs` checks the actual results dialog with
  fixture data, without authentication, application DB access, or live scans.
