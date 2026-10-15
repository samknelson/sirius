# Financial participant and payer identity

## Confirmed S1 contract

S1 intentionally records a worker's **contact NID** in financial activity.
The per-worker ledger resolves `field_sirius_contact` and uses that contact as
participant. AR retrieval joins the contact back to the worker through that
field. Worker payment search uses the contact as payer; employer payers remain
employers. Allocation writes the payer NID as participant, but **payer,
participant, and transaction reference remain independent relationships**.
Never force an allocation beneficiary to equal a payment payer.

This is not a rule about “Health Fund - Employee Contributions” or any other
account name. It applies across financial accounts.

The authoritative chain is staged worker NID → `worker` id map → that exact
destination worker → its contact, checked against the source contact's
`contact` id map. One destination worker for a contact is not sufficient.
Names, email, Sirius-number similarity, amounts and current employers are
not evidence. The planner creates no identities.

Ambiguous source workers, missing/retired/broken mappings, disagreeing
destination contacts, competing shells and unproven destination workers are
refused. Valid direct-worker, shell-only, standalone-contact and employer
identities remain distinguishable. A shell that conflicts with the proven
source worker never takes precedence.

## Inventory and approval (inside the HIPAA boundary only)

These commands are **not authorized by merging the code**. Obtain separate
operator approval before running any remote command, restaging, sync or wet
repair. Do not use a live, changing source count as a repair acceptance target.

1. Identify a common source/staging extraction snapshot or checkpoint.
   Independently prove the exact source identity set and staged identity set at
   that checkpoint, not just matching count/min/max ranges. Use a non-PHI
   checkpoint label. No new extraction or restaging is part of this repair.
2. In the pinned migration runtime with the existing staging schema, run:

   ```sh
   npx tsx scripts/s1-migration/repair-financial-links.ts \
     --checkpoint '<reviewed-common-source-staging-checkpoint>'
   ```

   Default is a genuinely **read-only, repeatable-read transaction**: no
   bootstrap DDL, run-report inserts, EA creation, mappings or fingerprint
   writes. It takes the migration advisory lock, refuses concurrent migration
   activity and prints only aggregate counts plus an evidence hash.
   It does not inherit parent “lock already held” bypasses.
3. Review source classifications, `ar_identity_mismatch`,
   `payment_identity_mismatch`, `attribution_mismatches`, missing targets,
   unresolved/unloaded rejects, and `blocked`. A missing staged-to-target row
   is not a linkage candidate. Known never-loaded source rejects remain
   distinct from unsafe loaded identities; existing reject/parity policies
   still apply. Resolve every loaded-row blocker first. The command does not
   expose record IDs or per-worker amounts; any needed record-level review
   must remain inside approved tools in the HIPAA boundary.
4. Separately approve the exact dry-run evidence hash. Only then run:

   ```sh
   npx tsx scripts/s1-migration/repair-financial-links.ts \
     --checkpoint '<same-reviewed-common-source-staging-checkpoint>' \
     --wet --approve '<reviewed-dry-run-evidenceHash>'
   ```

   Wet mode re-reads the entire plan under transactional source/identity and
   financial-table locks (5-second lock timeout, 120-second statement timeout).
   Any evidence change refuses the run before row-link writes. Any write or
   verification failure rolls the complete transaction back. Locks can briefly
   block financial or identity writes; arrange an approved maintenance window.
   If the run times out, investigate scale/lock contention and review a fresh
   dry run; do not remove safeguards.
5. The only row patches are ledger `eaId` and payment `ledgerEaId`, through
   storage, to canonical accounts. Canonical EAs may be created; existing EA
   entity ownership and fund accounts never change. No IDs, amounts, signs,
   status, dates, allocation flags, annotations, provenance or payment/hour
   references change. Native activity is not selected. Notifications and
   charge/allocation plugins are suppressed; no rebilling is performed.
6. Before commit, compare fund-level counts and exact numeric totals plus a
   complete financial-facts digest (including native rows and existing EA
   owners). Re-run exact identity verification. Ledger storage queues old and
   new worker/account/month coordinates after commit; drain deferred work
   before shutdown. A successful response includes `financialFactsUnchanged`.
   This queues derived-state refresh; it is not a claim that background scans
   have completed.
7. Re-run dry inventory: no loaded identity mismatches or blockers. A fresh
   hash-approved wet run is idempotent (`rebound: 0`). After separate approval,
   run the existing zero-cent balance parity harness against the same staged
   checkpoint. Its independent identity gate checks every relevant row,
   including unchanged fingerprints, and internally checks per-entity/account
   count and cents attribution. Only aggregate coordinate/mismatch counts are
   printed. Wrong-worker links fail even when fund totals balance.

## Normal load and sync

Payments and AR independently use the same identity planner. The narrow,
keyset-paged source worker/contact relationship index is built once per pass;
mapping and destination lookups remain page-bounded. No worker-bundle scan is
performed for each AR page. The fleet remains **payments → hours → ledger**.
The payment-reference and payperiod/hour crosswalk fixes are unchanged.

Both loaders check target ownership/coordinates on every page, including
source-unchanged rows; the final audit also checks exact identity and
per-entity/account attribution. A source hash or loader version alone is not
proof of the target. Missing AR targets re-enter standard reconciliation;
missing mapped payments retain the existing explicit rejection policy.

**Historical identity drift is deliberately fail-closed without approval.**
Neither a version bump nor `--force-reconcile` authorizes it. The recommended
historical correction is the separately reviewed link-only repair above.
Initial loads use the correct worker immediately. A matching target stays
unchanged, without rewriting money or references.

For normal recurring S1-wins reconciliation, an operator may instead review
a stream-specific dry inventory (`--stream payment` or `--stream ar` on the
repair command). Direct money loaders accept
`--financial-links-checkpoint <same-label> --approve-financial-links <stream-hash>`.
The fleet accepts `--financial-links-checkpoint <same-label>` plus
`--approve-payment-links <payment-stream-hash>` and/or
`--approve-ledger-links <ar-stream-hash>` and forwards them only to the
respective money loader. These are per-run approvals, never profile defaults.
The loader rechecks the hash and refuses blockers, then permits only the
exact reviewed old-row/old-EA/new-entity/fund coordinates through standard
in-place reconciliation. Identity drift forces reconciliation even when the
financial source fingerprint is unchanged. A changed mapping, different
beneficiary, or changed target evidence requires a fresh review.

Unlike the separate link-only repair, an approved **normal sync** remains
S1-wins for other migration-owned fields. Do not use it when the approval
authorizes only link changes. Normal sync assumes the usual shadow target
and migration lock; the separate repair also takes transactional table locks.
Run against the reviewed staged checkpoint (for a daily fleet, `--skip-stage`
keeps the staged snapshot; do not restage as part of this approval).
Earlier steps that change reviewed evidence—including creation of a
canonical EA—may intentionally invalidate a later stream's hash. Stop, review
a fresh stream inventory, and continue only with separate approval; do not
disable evidence checks. This approval sequence also covers later identity
dependency changes without changes to financial source content.

## Operator evidence and remote proof status

The supplied source observations were 5,038 cleared AR rows across 958
contacts, each having exactly one source worker. Staging held 5,037 rows,
loaded to the matching 958 destination contacts, each with one destination
worker. Source payments included 1,428 payments across 638 contact payers and
49 across 14 employer payers. These are source observations, **not** proof all
payments loaded successfully.

The live source's additional AR row and higher maximum ID are consistent with
an entry after extraction. Range/count evidence does not prove set equality.
Do not call this a loader rejection or confirmed extraction defect. Report
source/checkpoint differences separately from linkage results and compare
only the common snapshot.

Local executable fixtures verify policy, inventory, approved transactional
repair, unchanged-source mapping changes, invariants and storage movement
events. No remote database, restaging, loader/sync, or wet repair was executed
as implementation verification. Real checkpoint equality, remote query costs,
applied repair results, worker-page retrieval and background derived-state
completion remain operator proof, pending separate approval.
