# Daily financial identity: operation and proof

## Status and boundaries

The historical link-only repair and independent dry inventory are recorded in
[the operator repair evidence](financial-worker-link-repair-evidence.md).
That approval did **not** authorize a subsequent sync, restaging, deployment or
schedule change. The separately approved real daily-path proof is **pending**.
At the user's explicit closeout request, the implementation and local
verification are being delivered for merge, with the real daily-path proof
moved to a post-merge follow-up. Closing the implementation does not establish
production acceptance: local fixtures and the earlier repair alone are not
daily-run proof.

This change does not run remote commands, handle credentials, change schedules,
or add a repair command to the fleet. The existing **Prove the corrected
production sync before enabling its schedule** task retains production image,
connectivity and schedule-enablement proof. Completing this proof is only one
input to that rollout, never permission to enable it.

## Ordinary recurring path

The actual scheduler entrypoint is:

```sh
npx tsx scripts/s1-migration/run-scheduled-daily.ts
```

It accepts **no arguments** and launches exactly:

```sh
npx tsx scripts/s1-migration/sync.ts --mode daily --profile production --skip-seeders
```

This stages a new daily generation. It neither skips staging nor forces
reconciliation. Financial-link approvals cannot be supplied to the wrapper,
inherited from profiles, or stored as standing approval tokens. The deliberate
daily seeder omission retains existing policy; it does not skip money loaders.

`sync.ts` checks every shipped loader version before staging. The money steps
remain `t19-payments` v2 → `t20-hours` v2 → `t18-ledger` v3. Hours retains
`--migration-mode`; payment and ledger writes retain notification and
charge-plugin suppression. Payment/hour references remain independent of
payer/participant identity. Neither `repair-financial-links.ts` nor
`repair-hour-links.ts` is a fleet step.

Payments and ledger read the source worker/contact relationship index and
resolve each page through the exact worker mapping and destination contact
cross-check. Employers and proven standalone contacts keep their own entity
kinds. Missing, retired, ambiguous, broken or competing evidence cannot turn
into a contact fallback or authorize moving money.

Both loaders check existing targets **before** accepting an unchanged financial
fingerprint. A new payment/AR row uses the proven worker and canonical fund
account immediately. A proven dependency change cannot silently retain the
wrong worker, even if money content and fund totals are unchanged. Historical
identity drift refuses unapproved reassignment, including forced runs.

After the fleet, balance parity independently inventories identity and
per-entity/fund count-and-cents attribution. It is not governed by money
tolerance or money mismatch allowances. Wrong workers fail even if fund totals
balance or wrong-worker amounts cancel each other.

## Reading failures

- Each completed money step retains `financialIdentity` aggregate counts in
  the sync's `fleet` record. Missing/malformed identity evidence on a wet
  money-loader PASS is itself a failure.
- `financialIdentity` at the sync root records the independent balance audit;
  `gates.financialIdentity` and `gates.parity` must both pass. The orchestrator
  refuses a balance child PASS with absent or failing identity evidence.
- An early fleet refusal can leave the independent audit `not-run`; this is
  **not** an identity pass. A money process that refuses before emitting its
  envelope still produces a failed aggregate fleet record with remediation.
- Money failures point to a read-only, stream-specific inventory at retained
  staging. Investigate reject/ownership/identity classes inside the approved
  boundary. Do not infer worker identity from balances, names or destination
  worker cardinality, and do not bypass a refusal using force or dev profiles.
- Scheduled alerts include aggregate identity counts, not rebind candidates,
  row snapshots, worker IDs or per-person amounts. A nonzero child exit always
  produces a failure alert, even if an obsolete PASS result file exists.

## Exceptional approved normal reconciliation

This is distinct from the preferred **link-only historical repair**. Normal
sync is S1-wins for its other migration-owned fields. Obtain approval for that
broader behavior; link-only approval is insufficient.

1. Retain and independently verify a common source/staging checkpoint. The
   checkpoint label alone does not establish equality or freeze the data.
2. With separate read approval, inventory each needed stream:

   ```sh
   npx tsx scripts/s1-migration/repair-financial-links.ts --checkpoint '<reviewed-label>' --stream payment
   npx tsx scripts/s1-migration/repair-financial-links.ts --checkpoint '<reviewed-label>' --stream ar
   ```

   These commands are read-only inventories, not recurring fleet steps.
3. Resolve blockers and obtain separate approval of each exact stream hash.
   With explicit wet normal-sync approval, the supported fleet invocation is:

   ```sh
   npx tsx scripts/s1-migration/sync.ts --mode daily --profile production \
     --skip-stage --skip-seeders \
     --financial-links-checkpoint '<same-reviewed-label>' \
     --approve-payment-links '<payment-stream-evidenceHash>' \
     --approve-ledger-links '<ar-stream-evidenceHash>'
   ```

   Supply only the stream flags actually reviewed. Payment approval goes only
   to payments, AR approval only to ledger. No approval goes to hours, staging,
   parity or other fleet steps. The aggregate stores approval-presence booleans,
   not reusable hashes.
4. The receiving loader re-inventories that stream before reconciliation.
   Changed evidence or blockers refuse it. An approval permits only the exact
   reviewed row, old EA, expected entity and fund. It is not blanket authority.
   Earlier fleet steps can invalidate later evidence. Stop and review a fresh
   inventory rather than restaging, widening approval, or bypassing the check.
5. Review aggregate gates and a subsequent ordinary unchanged run. In-place
   reconciliation retains payment/ledger IDs and reference targets; it never
   merges people or reparents an existing EA.

## Required operator proof packet — not yet executed

Agree the precise command and read/write/restaging scope **before** execution.
The real scheduled wrapper always stages; approval for a retained-staging
manual run does not authorize that extra source read or new generation.
Conversely, `--skip-stage` manual proof is useful but does not alone prove the
actual scheduler wrapper. Do not loosen the wrapper to accept operator flags
just to keep the old checkpoint.

Capture sanitized evidence inside the approved HIPAA boundary:

| Evidence | Required result |
| --- | --- |
| Runtime identity | Full code commit, immutable migration image digest, actual ECS task image digest, task-definition revision, command, start/end and exit status |
| Checkpoint | Identify the exact staging generation used by that command; independently prove source/staged identity sets at that extraction boundary. Count/min/max or a reused label alone is insufficient |
| Pre/post baseline | Use that **same** staged checkpoint for inventory/parity comparisons; distinguish new daily source activity from the historical repair baseline |
| Fleet | Expected versions, payments → hours → ledger order, hour migration mode, no repair or scheduled force/approval flags |
| Identity | Zero loaded identity/ownership blockers, zero wrong payer/participant, zero attribution mismatches; retain aggregate classification counts |
| Money and references | Zero-cent parity, preserved historical payment/hour references and independent payer/beneficiary relationships |
| Completion | Sync aggregate and sanitized wrapper alert agree with actual process exit; capture all failed gates rather than reporting fund totals alone |
| Repeat | Separately authorized subsequent ordinary daily run; explain new source activity and demonstrate unchanged rows do not generate identity rewrites |

The historical repair's **107 missing payment targets** remain unresolved
observations, not proof of identity failure or permission to create/reclassify
them. The daily run must account for them through actual loader rejects and
parity outcomes. Do not suppress a gate to manufacture a green proof.

No successful daily financial proof is established here. Scheduling remains
gated by the existing rollout task after review of separately approved operator
evidence.

## Operator-supplied manual attempt — stopped before money loaders

The operator reported configuring a new image/task definition and supplied a
manual sync aggregate. Its extraction timestamps span
`2026-11-10T23:02:12.784Z` through `2026-11-11T00:22:29.704Z`.
This is operator-supplied evidence, not an assistant-executed remote action.
No new remote action or retry is authorized by supplying this report.

- Reported options: daily, production, wet, staging enabled, seeders skipped,
  `keepGoing: false`, `forceReconcile: false`, and neither payment nor AR
  financial-link approval present.
- Stage reported PASS, zero mismatches and five accepted live drifts.
  Contacts, workers and payments report `identityVerified: true`. Payments
  staged `4731` rows, with `17` payloads extracted. Raw AR staged/extracted
  `392237` rows with equal before/after counts, but this aggregate contains
  no exact AR identity-set hash. Counts alone do not establish that proof.
- The fleet stopped at `t16-elections` logic version `2`, exit code `1`:
  `appeal_worker_unmapped=1` was a disallowed reject. Its local verification
  PASS does not override the failed reject gate.
- Local source inspection shows that rejection means an appeal had no usable
  worker reference or no worker mapping for its reference. The aggregate does
  not distinguish those causes or connect it to the contact/worker rejects.
  Operator-side retained reject evidence and staged worker/mapping evidence
  are needed before deciding remediation; no allowlist change is justified.
- Overall result: FAIL; fleet gate failed; parity skipped;
  `financialIdentity: not-run`; WMB processing skipped.
  Reported duration was `8117.1` seconds. Earlier fleet steps did write:
  aggregate totals include `293` created and `75` updated records. This is
  not a no-write attempt or evidence of whole-run rollback.
- Payments, hours and ledger were not reached. There is no loaded financial
  identity, attribution, money-parity or reference-preservation result.
  The earlier `107` missing payment targets remain unresolved; the new
  staging count cannot identify their disposition.

Still missing: full delivered code commit, immutable image and actual ECS task
image digests, task-definition revision, exact launch command, task identity,
overall task start/end and final container exit status. A child election exit
and a sync FAIL report do not prove the wrapper's final exit or alert behavior.
The supplied record does not establish whether the scheduled wrapper was used.
The staging generation/range evidence and same-checkpoint inventory/parity
comparison are also absent. No repeat-run evidence was supplied.

Next: coordinate the missing runtime packet and upstream election triage with
the existing rollout owner. Review an exact, separately approved operator
diagnostic before any remote read, and separately approve any remediation or
new daily run. Keep the election gate intact; do not use keep-going, new
allowances, force-reconcile or a reused checkpoint label to obtain acceptance.
The financial proof remains blocked, not complete.

## Local executable verification

`tests/s1-migration/financial-money-loaders.test.ts` executes the actual payment
and ledger CLI modules, real identity planner/resolver, fingerprint classification
and approval-coordinate checks against simulated IO. It covers fresh exact
worker/fund resolution, distinct employers/contacts, broken dependencies,
unapproved/forced refusal, source-unchanged approved in-place changes, stale
approval, retained payment/hour references and subsequent unchanged runs.
Its final inventory is simulated; the independent read-only inventory and
stale evidence hashing are covered by `financial-link-repair.test.ts`.

`financial-sync-fleet.test.ts` imports the actual orchestrator with simulated
child processes and database IO. It checks shipped version preflight, actual
argument/order wiring, approval isolation, pre-write input refusal, aggregate
evidence propagation and zero-total-drift identity failures.
`scheduled-financial-path.test.ts` executes the actual wrapper with a simulated
child and alert transport, testing the fixed command, refusal of injected
approvals, identity evidence, failure alerts and child-exit/report disagreement.
These fixtures are not remote database or live scheduler proof.

```sh
npx vitest run tests/s1-migration
npm run check
```

Local result on 2026-11-10: 174 tests passed; three pre-existing structural
time-zone tests failed. Running that test file against an isolated archive of
the unmodified base reproduced the same three failures: its entrypoint
allowlist is stale, its Dockerfile assertion assumes an old migration-stage
name, and the late-check script repeats the literal zone. These were not
changed or waived by this financial-link work. Both halves of `npm run check`
and all 16 `npm run lint` rules passed. No live database or scheduler proof
was performed.
