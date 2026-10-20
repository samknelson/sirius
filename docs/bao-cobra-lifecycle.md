# COBRA lifecycle and safe reconciliation

## Confirmed policy

The initial obligation is **every coverage month from the COBRA effective month
through the election month, inclusive** (confirmed by the product owner on
2026-10-15). Later statement months are evaluated separately.

No forfeiture, reinstatement, collection, billing, allocation, rate, or fee
policy is introduced here. The deadline calculator remains authoritative:
60 days to elect, 45 days after election for first payment, and 18/36-month
maximum periods. Periodic grace remains 30 days from the first of the
**unpaid obligation's** month, never ending before the initial deadline.
The deadline day is included. Moving to a new calendar month never renews
old debt's grace.

## Transition matrix (highest precedence first)

| Evidence/action | Result | Precedence and limits |
| --- | --- | --- |
| Current status has `closed=true` | Unchanged | No financial event or scan reopens it. Explicit staff editing remains separate. |
| Today is after maximum-period date | Closed | Applies to elected and unelected open cases; requires a unique named Closed option with `closed=true`. |
| No election; regular medical/dental benefits restored | Closed | Preserves the existing **unelected-only** rule. Elected-case termination on restored benefits is not inferred. |
| No election, otherwise | New; payment state cleared | An elapsed election window prevents posting, but does not invent automatic closure. |
| Election posted | Pending First Payment | Wizard records election and case in one transaction. A locked recheck refuses a staff-closed or changed case. |
| Missing/ambiguous account or status; missing/ambiguous benefit election; missing initial premium; overlapping elected cases; competing statement-month obligations | Blocked, unchanged | Explicit diagnostic, not a successful paid/no-op result. Includes closed-case premiums sharing an allocation month. No financial repair is attempted. |
| Any initial month lacks sufficient qualifying payment, within deadline | Pending First Payment / grace | Every initial month needs positive net posted case premium evidence. |
| All initial months paid, later unpaid premium still in grace | Enrolled / grace | Later debt does not redefine the initial obligation. |
| All initial months paid, no unpaid posted premium | Enrolled / paid | A cleared payment needs an actual posted allocation in each relevant statement month. |
| Any posted unpaid obligation past its own window | Delinquent / delinquent | Applies before or after first-payment enrollment. |
| Delinquent, required monthly obligations subsequently paid | Enrolled (or Pending First Payment if initial still unpaid within its window) | Same evaluator; no automatic reopening of Closed. |
| Payment pending/failed/canceled/unallocated, insufficient, removed, reversed, or moved away | Re-evaluate above | Payment status alone or whole-account zero balance is not evidence of payment. |
| Case election date/effective date edited | Re-evaluate initial months and centrally recomputed deadlines | Existing staff edit path remains; no financial mutation by the lifecycle service. |
| Election benefits/period edited or election removed | Rebill through the existing election listener, then re-evaluate | Missing matching election or missing initial premium blocks status reconciliation. It does not silently close or reinstate a case. |
| Staff selects a closed status | Closed | Subsequent automatic reconciliation preserves it. |

The lifecycle calculation uses **case-attributed premium cents** and
**cleared credit-payment allocation cents**, per statement month. Arbitrary
ledger credits and other periods cannot satisfy the obligation. Premium
adjustments change the case's net obligation, but an adjustment without a
base premium is not proof of billing. Multiple enabled global COBRA billing
accounts are an error instead of selecting the first account.

Statement allocations do not carry a case identity. They may only stand as
case payment evidence when that statement month has no competing positive
posted obligation. The ledger query checks all entries, not merely open cases:
a closed case's premium or unrelated charge in the same month blocks
reconciliation. This is deliberately conservative even if another obligation
has an offsetting reversal: this service cannot prove which case consumed the
shared payment and does not invent an allocation priority.

### Monthly benefits are a different decision

The benefit eligibility plugin retains its requirements: an elected open case
and matching benefit election in the coverage window, positive case premium,
an allocated payment, and an **exactly zero** statement-month balance.
Enrolled, grace, or an overpaid case does not itself grant an unpaid month.

## Delivery, concurrency, and recovery

- The existing `LEDGER_ENTRY_SAVED` event fires after commit for charges,
  adjustments, payment-allocation upserts/deletes, and old/new financial
  coordinates. Only the affected worker on the resolved COBRA account is
  reconciled. There is no second payment listener or charge lifecycle.
- Relevant case changes use the same reconciler. The existing election billing
  listener invokes it after its scoped billing/reversal work, even on a
  no-charge outcome. A no-change decision never writes or re-emits.
- The restored-benefits handler defers its work with `onAfterCommit` because
  `WMB_SAVED` itself is an in-transaction event. It then checks committed
  benefits on a fresh connection. A rolled-back benefit neither closes the
  case nor schedules closure; this does not change charge listeners' atomic
  in-transaction behavior.
- Financial transactions roll back without emitting ledger events. Deferred
  handlers explicitly exit the caller's ambient transaction.
- A fresh case is read under `FOR UPDATE` in one transaction. This serializes
  with every staff update: a committed closure is seen, and a staff closure
  waiting behind reconciliation wins afterward. Normal wrapped case storage
  writes preserve existing audit/history and benefit-rescan behavior.
- The existing `bao-cobra-status-scan` cron calls the same reconciler in bounded
  keyset batches (5,000 cases per execution). Broken status joins are included.
  Case errors do not stop other cases; blockers or truncation fail the job
  visibly rather than reporting success. A large deployment must inspect
  truncation and run targeted reconciliations for the remaining cases.
- No cron schedule, enablement setting, or broad billing job was changed.
  Time-driven transitions require an enabled status scan and a running,
  correctly zoned scheduler whose deployment policy permits it. Event-driven
  payment transitions do not require waiting for that scan.

## Read-only incident evidence (2026-10-15)

Only the workspace development database was accessible. The production database
reader reported that no Replit-managed production database was available;
that is **not** evidence about a separately hosted deployment.

For the reported worker's own case, the available data showed:

- Status **New**, not the reported Pending First Payment.
- Effective/election date June 1, 2026; initial deadline July 16, 2026.
- No matching COBRA benefit election and no case-attributed premium entries.
- Cleared credit and charge-direction payment records/entries on the configured
  COBRA account. These do not replace a posted case premium or matching
  election; the worker's payment attribution must not be guessed.
- One global COBRA charge account and all five named lifecycle statuses.
- Both billing and status scan configured enabled, at `0 4 * * *` and
  `30 4 * * *` respectively. Historical live status-scan successes were present
  through September 30; that alone does not prove current scheduler health.

After the development application restart, startup logs confirmed cron
execution was permitted and both COBRA jobs were scheduled with those same
expressions. This confirms development scheduler prerequisites, not a
successful future status scan or the inaccessible deployment's configuration.

The shared reconciler's actual dry run returned **no changes** and:
`Exactly one matching COBRA election with benefits is required`.
No target status correction was applied because the available evidence does
not authorize Enrolled. The confirmed software defect is lack of an immediate
ledger-driven lifecycle update; it is **not a confirmed explanation of the
reported remote Pending case**.

A bounded dry run with the conservative shared-month attribution guard
inspected 18 open cases: two blocked cases (the reported own case and another
case sharing statement months with other obligations), two proposed
payment-state updates, and no truncation.
Those other cases were **not changed**. No financial data was changed by
diagnosis or reconciliation. PostgreSQL regression fixtures ran only in
disposable isolated schemas.

## Operator procedure inside the authorized data boundary

1. Confirm the database/environment first. Inspect the reported covered-person
   and subscriber links, matching COBRA election and its benefits/period,
   case premiums/adjustments by statement month, allocations, current source
   payment statuses, configured account/status options, scan configuration,
   deployment cron policy, and recent scan runs. Read only at this stage.
2. Coordinate financial-link discrepancies with the existing migrated-worker
   financial-link repair work. Do not infer that a payment belongs to a worker
   from an account balance, a subscriber link, or the fact that a payment exists.
3. In the staff case details page, choose **Preview status reconciliation**.
   The default is read-only. Review the named target, initial-obligation
   finding, payment-state change, and every blocker. Resolve data/policy
   discrepancies through their authorized workflow, not direct status SQL.
4. If the preview is supported and authorized, select **Apply status
   reconciliation**. Evidence is recomputed under lock. It changes only
   case/payment status using ordinary audited storage, never financial data.
5. Reload both staff case details and worker COBRA tab. They use persisted
   case/payment status; financial blockers are shown separately. Verify each
   relevant benefit month independently through normal eligibility scans.
6. Review status-scan schedule prerequisites and the next run outcome before
   relying on time-driven recovery. Do not enable broad billing to repair a
   status. The status scan alone does not bill or collect.

For authorized scripted use (same staff access/component gates as case editing):

```text
POST /api/sitespecific/bao/cobra/status-reconcile
{"caseIds":["<case UUID>"]}
```

Omitting `mode` means `test`. Omitting case IDs previews at most 500 open cases
and reports `truncated`. A live request requires 1–100 explicit case IDs:

```text
{"mode":"live","caseIds":["<reviewed case UUID>"]}
```

Each result reports `before`, `changes`, `targetStatusName`,
`initialSatisfied` when known, `blockers`, and `applied`. Errors remain per-case.
Do not treat HTTP 200 alone as evidence of success.

## Verification

Regression suites cover initial month inventory, partial/absent payments,
missing/reversed premiums, month/year/deadline boundaries, delinquency and
recovery, closed/max-period cases, restored benefits, configuration blockers,
duplicate events and bounded scan recovery. Real PostgreSQL tests exercise
the actual payment allocation plugin, executor, ledger storage, after-commit
event, reconciler, row locks, rollback, deletion and statement moves in
isolated disposable schemas.
They also create a current-month benefit through real WMB storage, proving
unelected-case closure after commit and no closure after rollback.

Built-in help ID: `system:bao-cobra-lifecycle`, matching only COBRA worker tabs
and COBRA case pages. No locally authored help rows are changed. Tests verify
registry registration, sanitization, near-miss paths, authenticated route
listing/lookup with local entries preserved, and the staff preview/apply UI.
Protected deployment UI and the real signed-in Help dialog still require
verification in an authorized session; source/fixture tests are not a claim
that those production screens were viewed.
