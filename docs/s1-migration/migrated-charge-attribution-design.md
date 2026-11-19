# Migrated charge attribution — discovery and decision report

**Date:** 2026-11-19  
**Status:** Discovery report delivered with partial real-stage inventory and
explicit implementation blockers. Source producer semantics and target/config
evidence remain unproven. No implementation approval.

## 1. Recommendation and evidence boundary

Prefer **explicit loader attribution to a native plugin and a proven configuration,
while preserving each source row as a separate historical base**. Reconcile the
whole signed billing-unit total, not a single imported row. Do not copy a native
base key onto imports. Do not add further per-plugin S1 searches.

**Direct attribution alone is not sufficient.** Native callers differ in lookup,
metadata, verification and mutation behavior. A bounded first implementation needs:

1. One durable, plugin-independent source-identity predicate and uniqueness
   contract, shared by migration consumers.
2. One exact, deduplicated reconciliation-group reader and append-only delta
   operation for the selected family, used by execution **and verification**.
3. A guard preventing ordinary native update/delete/upsert paths from modifying
   imported historical bases, plus an explicitly authorized loader write path.
4. Serialization through the actual ledger commit, including deferred batch writes.

Start with **BAO employer hourly, conditionally**, because the payperiod → monthly
hours crosswalk and imported-net reconciliation already exist. That is an engineering
advantage, **not proof that every payperiod-referenced AR row belongs to hourly**.
No real-source family is approved for automatic attribution yet.

Do not migrate premium, DP, COBRA, ECHP or EE contributions merely because a reference
or account looks compatible. Their missing source discriminators and richer billing
identities are blockers. Keep allocations, unrelated credits and unknown rows outside
charge groups. Negative charge corrections belong in a group only with positive
evidence of that family; sign alone proves nothing.

### Evidence available, and evidence not available

* **Verified from current repository:** T18 preserves source keys/JSON/references;
  T20 aggregates multiple payperiods into monthly hours; the native code contracts
  described below; the operator-only real-data access boundary in
  [08-ledger-payment-reconciliation.md](08-ledger-payment-reconciliation.md).
* **Real-stage evidence received:** operator-returned Q0–Q3, the first Q4 result
  and F1–F2 on 2026-11-19; counts and limitations are recorded below.
  F3 timed out, and an unbounded retry was aborted and rolled back without a result.
  The S1 charge-producing
  implementation, decoded payload semantics and target/config inventory are still
  unavailable.
  Workspace secret-existence inspection found no `S1_DATABASE_URL` or
  `EXTERNAL_DATABASE_URL`; this is not an attempt to connect to production.
* Existing recorded migration counts and old query-pack questions are not a charge
  family inventory. Synthetic generators, smoke fixtures, opaque keys in examples,
  rates and matching amounts are **not production proof**.
* The user explicitly requested that real-data queries be run by them. The
  [read-only query pack](charge-attribution-inventory.sql) was prepared and requested.
  **No source family literals or unreturned result counts have been invented.**

## 2. Aggregate inventory and source evidence request

The SQL packs document the requested aggregate-only evidence on the intended
**real staged S2 target**, not the development fixture DB.
**Do not rerun either pack wholesale. Q5 and F3 are now disabled in block comments
after the unsuccessful target/unit investigation.** No further full-population
query is requested as a condition of delivering this discovery report.
Confirm any future query's database privately in Q0. Each runnable block uses a
read-only repeatable-read transaction, bounded statement/lock timeouts and rollback.
It performs no bootstrap, report insert, function creation, repair or plugin call.
Q3 requires PostgreSQL 16+; stop/skip rather than substituting an unsafe JSON cast.
If a statement fails, roll back the transaction before the next block. Do not
share database names or parser errors that might quote input.

| Query | Purpose | Current result |
|---|---|---|
| Q0 | Private target/version and relation availability | PostgreSQL 17.12; all four queried relations present |
| Q1 | Staging extraction interval/hash completeness; status/sign census | 405,636 rows; no missing hashes; all Cleared |
| Q2 | Key structure × reference bundle × participant bundle × fund account × sign; exact aggregate cents | Received after a timeout/retry; counts reconcile, monetary results kept out of committed report |
| Q3 | Valid/invalid JSON, root types, candidate field types/cardinality, no values | 405,636 nonempty invalid JSON inputs; no decoded discriminator evidence |
| Q4 | Key reuse across account/participant/reference; repeated reference bundles | Key-reuse result received; second reference-bundle result not supplied |
| Q5 | Many-to-one payperiod/month grouping, missing targets, zero/one/multiple candidate hourly configs | No result; withdrawn along with the unsuccessful F3 reformulation |
| Q6 | Source-provenance health, duplicate source IDs, mixed imported/native groups | Not returned; target-ledger proof blocked |
| Q7 | Known BAO configuration cardinalities by scope/account/enabled state | Not returned; config inventory blocked |
| F1 | Payload encoding signatures and lengths, without raw values | 405,636 in other/private-review bucket; every trimmed payload length = 15 |
| F2 | Numeric/three-token key relation to reference and participant | All 396,028 numeric keys equal reference; no three-token component equals reference/participant |
| F3 | Payperiod coordinates, config ambiguity and many-to-one units | Timed out; unbounded retry never returned, operator aborted and rolled back; no result |

**Privacy:** participant IDs appear only in internal grouping/join operations,
never output. No memo, raw key, JSON payload/value, employer ID, worker ID or
per-person amount is returned. Fund-account identifiers and aggregate signed cents
are allowed results; keep real monetary outputs within the approved boundary and
do not commit them to this report. Q2 maps letters/digits/other characters to
`A`/`N`/`X`: this deliberately hides literal prefixes and cannot identify a family.
Q3's field names are explicitly **probes, not asserted S1 fields**; all other names
collapse to a private-review bucket. It cannot establish discriminator semantics.

### Received real-stage results and implications

Q1's extraction interval was **2026-11-19 09:20:52.532111–09:21:41.557711 UTC**,
with **0 missing hashes**. The sign census was **388,735 positive**, **16,600
negative** and **301 zero**, totaling **405,636**. These are stage observations,
not independently proven current live-S1 counts or target-ledger parity.

The returned Q2 cohorts sum to exactly the same population:

| Source account | Reference bundle / participant bundle | Key shape | Positive | Negative | Zero | Total |
|---|---|---|---:|---:|---:|---:|
| 2457512 | payperiod / employer (`grievance_shop`) | N | 305,295 | 10,747 | 300 | 316,342 |
| 17602972 | payperiod / employer | N | 79,278 | 360 | 0 | 79,638 |
| 2457513 | payperiod / contact | N | 45 | 3 | 0 | 48 |
| 2457513 | JSON-definition node / contact | NXNXN | 3,633 | 3 | 0 | 3,636 |
| 2457512 | employer / employer | null | 94 | 0 | 0 | 94 |
| 17602972 | employer / employer | null | 6 | 0 | 0 | 6 |
| 2457512 | payment / employer | null | 166 | 2,661 | 1 | 2,828 |
| 2457513 | payment / contact | null | 213 | 2,675 | 0 | 2,888 |
| 17602972 | payment / employer | null | 5 | 151 | 0 | 156 |

* **395,980 employer/payperiod rows** across two accounts are hourly **candidates**,
  not one proven family. The two account roles, historical rates, employer
  agreement and config mapping still need evidence. In particular,
  `load-employer-rates.ts::resolveHourlyAccount` requires exactly **one** enabled
  `bao-hourly` config and loads rates only to that config's account. This is a
  verified loader limitation, not proof of current target settings. Do not assume
  both observed source accounts have supported hourly rates/configs or silently
  reuse one account's rate for the other.
* **48 contact/payperiod rows** may represent a worker-billed obligation, but the
  data does not establish ECHP (or any other plugin). Do not merge them with the
  employer-hourly candidates.
* **3,636 contact/definition rows** have a three-numeric-run structure. `NXNXN`
  does not disclose delimiters or token meanings. A `sirius_json_definition`
  reference is neither an election nor a COBRA case nor proof of EE contribution;
  it can describe a definition rather than a runtime billing subject.
* **5,872 payment-reference rows** include **384 positive**, **5,487 negative**
  and **1 zero**. Positive payment-related reversals/corrections must not be
  misclassified as charges; negative sign alone cannot identify allocation.
* **100 positive, null-key employer-reference rows** remain a separate unsupported
  cohort. Do not infer a recurring fee or copy a native plugin key.

Q4 reports **301,754 distinct nonblank keys**, **89,233 repeated keys** spanning
**187,143 rows**, **79,023 multi-account keys**, **631 multi-participant keys**,
and **0 multi-reference keys**. Nonblank row count reconstructed as
`301,754 − 89,233 + 187,143 = 399,664`, matching the payperiod/definition cohorts.
This confirms keys are **not globally source-row-unique**, and warns that account
and participant cannot be omitted from review. It does **not** prove repeated
rows are duplicates. F2 subsequently tested numeric-key equality directly.

Q3's universal parse failure means **treat the column as opaque text**,
not a JSON object. It does not yet establish PHP serialization, base64, encryption,
corruption, or loss during extraction. No JSON field probe produced usable
discriminator evidence. The loader currently preserves the string, which remains
appropriate until its producer/storage encoding is established.

The operator reported an initial statement timeout, and obtained Q2 after removing
timeout settings; elapsed time and precise initial timed-out statement were not
supplied. A second formulation, **F3**, aggregated AR first, restricted stage joins
to payperiods and moved config counting to distinct employer/account pairs.
**It also timed out. The unbounded retry never returned and the operator aborted
and rolled it back.** There is no F3 coordinate/config/fan-in result to interpret.
Both full-population unit formulations are now withdrawn, not described as verified
or performant. Q6/Q7 results were not returned either.

The successful [follow-up queries](charge-attribution-follow-up.sql) establish:

* **F1:** every trimmed payload is exactly **15 characters** and matched none of
  the tested PHP, entity-encoded JSON, quoted-text, hex or base64 signatures.
  Constant length does **not** prove a constant value, a redaction marker, valid
  serialization or corrupt extraction. A masking placeholder is a hypothesis only.
  The current extractor copies `ledger_json` as a string and staging strips NUL;
  no decoding or fixed-length replacement was found on that path. Older mapping
  documents label sampled payloads MASKED, but that does not establish this
  checkpoint's contents or authorize treating a placeholder as a discriminator.
* **F2:** numeric keys equal the reference NID on all **316,342**, **79,638** and
  **48** numeric-key rows in the three respective account cohorts, totaling
  **396,028**. None equals the participant. For the **3,636** three-token keys,
  no tested token equals reference or participant. This proves numeric keys carry
  the observed reference identity, **not** a family identity or source-row identity.
  The compound key's separator and token meanings remain unknown. F2's token
  checks compare text exactly, so they do not rule out differently formatted
  representations such as zero-padding.

Further target/unit evidence is **blocked on a separately scoped investigation**:
first privately review a non-executing query plan/index inventory with the operator,
then, only if approved, validate a small explicit source-ID range with a timeout.
No `EXPLAIN ANALYZE`, unrestricted retry, schema/index change, loader or recalculation
is authorized here. Sampling can diagnose query mechanics but cannot establish
population-wide attribution; approval ultimately needs complete reviewed evidence.
First priority for source semantics is the S1 producer/redaction contract, not
another expensive join against undecoded staged payloads.

If encoding signatures point to PHP serialization, confirm with S1 producer code;
**never run PHP `unserialize` on untrusted payloads with class instantiation**.
Any later read-only decoder must reject object/custom/reference variants it cannot
handle safely, bound input/depth/output, and return only reviewed structural
discriminators. A signature match is not a decoded schema or family contract.

### Required second pass — do not guess from the first inventory

The returned first-pass evidence is a **partial structural inventory**, not a
completed target/config inventory or mapping approval.
Ask the operator to inspect the **actual S1 producer** privately and return a
sanitized contract (code locations and literal schema tokens only, no record data):

* Find every writer to `sirius_ledger_ar`, including charge creation, corrections,
  allocations, cancellations and deletes. Identify source module/function and
  revision/checkpoint. A grep result without tracing the write inputs is insufficient.
* For each branch record the exact `ledger_key` construction and escaping,
  JSON discriminator path/literal and version, meaning of reference NID,
  participant choice, account choice, service/billing month and sign rules.
* Establish whether corrections preserve a family tag, point at the original
  charge, or are indistinguishable from unrelated credits. Establish whether
  multiple AR rows are installments, corrections, line items or duplicate postings.
* Identify historic schema variants and retired modules; unknown variants remain
  unknown. If S1 code is unavailable, require independently reviewed source
  documentation and an in-boundary, stratified real-record review sufficient to
  prove the same contract. Amount equality is not an alternative.

Only then write a second **SELECT-only** classifier using those reviewed literals,
with exclusive branch matching and an explicit unmatched/multi-match bucket. Its
aggregate output must cross family + discriminator version + account + reference
bundle + sign + match count (0/1/>1). Count distinct source IDs before and after
joins so fan-out cannot inflate results. Profile all variants, not a small sample.

For each family, aggregate the number of candidate runtime units and configs per
source ID (0/1/>1); then group internally by the proposed canonical unit and emit
only a distribution of source rows per unit, with signed cents totals. Verify that
every accepted source row has exactly one unit, account/entity and config, and that
every group sums exactly. A future reviewed unit-validation query must cross-check
staged payperiod worker, employer and start month against the live hours row using
T20/repair's parsing contract. The withdrawn Q5 would only have checked crosswalk
existence, **not whether its target is correct**; F3 attempted the fuller checks
but produced no result.

Also cross-check the independently resolved financial participant against the billed
entity. Source contact NIDs financially representing workers must follow the exact
staged source-worker link, not destination worker cardinality. A payer is not an
allocation beneficiary. Reuse `lib/financial-identity.ts` and its reviewed
financial-link inventory semantics; do not infer the employer from today's home
employer or infer a subscriber from the financial contact alone.

Each query block has its own snapshot. Pair results with the saved stage generation,
run start/finish times and source-code revision privately. Different blocks are not
one atomic snapshot of an actively changing stage. A same-checkpoint second pass
or paused, already-authorized extraction window is needed before approval. A
recent `extracted_at` range alone is not proof of complete extraction.

## 3. Ownership matrix

The source column below is intentionally separate from the **verified S2 target
contract**. All rows retain source identity `(S1 instance, sirius_ledger_ar,
ledger_id)` independently of their runtime group; source instance must be stable
and explicit, not a hostname or credential.

`C` = applicable config; `EA` = billed entity-account. Current config resolution
uses enabled configs and employer-over-global override **per account**; it returns
all surviving configs, not an authoritative first match. A unique config today
does not establish historic applicability.

| Candidate family / source evidence required | Runtime plugin identity | Config and billed entity/account | Canonical unit/reference and many-to-one rule | Disposition now |
|---|---|---|---|---|
| Employer hourly: Q2 identifies 395,980 employer/payperiod rows on two accounts; still need producer proof of employer-hourly branch, account/correction semantics and validated worker/employer/start month | `bao-hourly` | C for mapped source account and payperiod employer after the executor merge; exactly one eligible C. EA = **employer** from the historic payperiod + mapped account, agreeing with independently resolved AR participant | C + EA + monthly `worker_hours.id`; reference `hour`, adjustments `hour_adjustment`. Many payperiods and many AR IDs may map to this one unit. Each keeps its own source ID/key; sum all signed family rows once | Strongest first candidate; real cohort and crosswalk plumbing evidenced, source-family/config proof pending |
| Provider premium: producer proves provider-premium obligation, subscriber, benefit, coverage month and provider | `sitespecific-bao-premium` | C/account and **trust_provider** EA from historical obligation must be proven; do not silently substitute today's benefit provider | C + subscriber + benefit + year/month, billed EA separately checked. `wmb` reference is an anchor, not the entire unit; own/dependent WMBs can represent one subscriber obligation | Blocked: no source family proof, historical provider proof or safe immutable group reconcile |
| Domestic partner: producer proves DP member charge, subscriber election, specific DP relationship, billing month, correction vs allocation | `sitespecific-bao-dp` | C/account; EA = subscriber **worker**. Account or subscriber mismatch refuses attribution | C + EA + election + DP relationship + billing month; `dp_election` / `dp_election_adjustment`; metadata `dpRelationshipId`, `billingMonth` is essential. Multiple AR lines cannot be assigned to every DP | Blocked: generic election/relation reference is insufficient |
| COBRA: producer proves covered-person premium obligation, exact S2 case mapping, election, service month and historical tier | `sitespecific-bao-cobra` | C/account; EA = covered-person **worker**, not assumed subscriber/payer | C + EA + COBRA case + billing month; `cobra_case` / `cobra_case_adjustment`. T18's election mapping is not a case mapping. Multiple source installments may form one month | Blocked: case/tier/month/source-family proof unavailable |
| Event Center purchase: Q2 identifies 48 contact/payperiod rows but does not identify ECHP; producer must prove purchase charge rather than another obligation or credit, and validate month/worker | `sitespecific-bao-echp` | C/account; EA = **worker**, unlike hourly employer billing. Prove source account/participant and qualifying purchase semantics | C + EA + monthly hours ID; `hour` / `hour_adjustment`. Payperiod aggregation alone cannot distinguish ECHP from employer hourly | Blocked: source proof and imported-base deletion safety missing |
| Employee contribution: producer proves policy/benefit/subscriber charge in month, historical granting policy and account | `sitespecific-bao-ee-contribution` | C/account; EA = subscriber **worker**, historized granting policy, never today's home employer | C + EA + subscriber + benefit + year/month + policy. Reference `bao_ee_contribution` = `subscriber:benefit:year:month:policy`; adjustments `bao_ee_contribution_adjustment`. Multiple dependent WMBs do not multiply the charge | Blocked: source family/policy evidence and equivalent metadata unavailable |
| Payment allocations/corrections: Q2 identifies 5,872 payment-reference rows, including 384 positive rows | No charge-family ownership | Preserve independently resolved allocation beneficiary/account; payer can differ | Preserve `payment` reference and source identity, excluded from expected charge/net math; payment ingestion remains T19 | Reference is an allocation candidate, not definitive classification without producer proof; never auto-attribute by sign or to a charge plugin |
| Other credit, manual adjustment, legacy/retired policy, ambiguous/missing/multi-match discriminator or unresolved reference; specifically 3,636 contact/definition rows and 100 null-key employer-reference rows | Remain `s1-import` | Preserve S1-derived EA/account | Preserve raw source facts; no fabricated runtime unit, native config or service month | Unsupported/ambiguous, explicitly inventoried; no automatic recalculation |

**No source family is confidently mappable yet from the available evidence.**
The confidently established facts are the returned source cohorts, source-row
identity and the payperiod/month reference transformation, not the business meaning
of arbitrary keys or the undecoded payload.
Even a positive, single-config payperiod row is only a candidate until source
evidence confirms its obligation.

### Config selection and time

Use the same `toChargeConfig`/`mergeEnabledChargeConfigs` logic as the executor;
scope to the named plugin, historic employer when relevant, and mapped account.
Employer configs override globals on the same account, not all globals. Two
survivors on the same account remain two candidates: refuse, do not choose by UUID,
name, sort order or a rate that happens to match the amount.

Persist the approved C and mapping-rule version. Do not silently reassign history
when a config is disabled, superseded, deleted or recreated. Current enabled config
selection is a useful candidate filter, not historical evidence. Require a reviewed
crosswalk/decision where the historic config has no S2 equivalent. Pricing remains
the plugin's ordinary historic-date rate and eligibility policy; classification must
not invent a rate, rewrite policy, or assume S1 and S2 expected prices are identical.

## 4. What ordinary reconciliation actually does

Evidence locations below refer to symbols/branches in the current files, not a
claim that an imported row already meets their preconditions.

| Consumer | Observed contract and failure of simple attribution |
|---|---|
| `charge/types.ts`, `registry.ts`, `executor.ts` | Registry selects enabled plugins/components; executor resolves configs, calls `execute`, then persists returned transactions. Config/plugin registration does not define historic ownership. Plugins may write/delete inside `execute`; calling them is **not read-only preview**. Default persistence soft-fails; collector can defer insertion |
| `storage/ledger.ts`: `getByChargePluginKey` | Exact plugin+key lookup (including pending collector entries). Renaming plugin while leaving `ar-ID` does not satisfy a canonical key lookup |
| `getByReferenceAndConfig` | Filters reference ID + config only: **not** plugin, reference type, EA or account. It merges pending entries. A shared reader must narrow the complete unit and deduplicate by durable ledger ID (and pending transaction identity); this method alone is not a safe group boundary |
| Hourly `execute` | Exact native key `C:EA:hoursId`; separately counts **all** `s1-import`/`hour` entries on same hours+EA. With no canonical base and no imports it creates a full base even if orphan native adjustments exist. Otherwise net = config/reference rows + imported total. A partially converted import with config set but old owner can enter **both** sets |
| Hourly no-longer-qualifying | When canonical native base exists it deletes every reference/config row, then offsets surviving imported facts; otherwise retains native offsets and computes residual. Attributed imports inside that broad delete set become destructible without guards and a different zero-applicability path |
| Hourly `verifyEntry` | Adjustments return valid early; base verification depends on stored metadata and bypasses status gating. It independently adds imported rows. Merely setting plugin/config supplies neither needed native metadata nor group-level assurance; import-only/adjustment-only units need verification even without a canonical native base |
| ECHP `execute`/`verifyEntry` | Execute reads reference/config net; amount changes append delta, but no applicability **deletes all group rows**. Verification treats base amount plus adjustments specially, so several imported bases are not automatically equivalent to one native base |
| Premium `execute`/`verifyEntry` | Key `C:subscriber:benefit:year:month`; creates, updates amount/data, deletes on no coverage, and deletes/recreates on provider/EA change. Verification expects worker/benefit/year/month metadata and compares **individual entry amount**. Native key adoption risks overwriting provenance; separate source keys would remain invisible and cause full-base creation |
| DP `execute`/`verifyEntry` | Discovers current and ever-billed elections; groups by metadata relationship+month. Reverses absent coverage/confirmed no-charge; reinstates zero-net months. **Nonzero covered months are not repriced**; drift is reported. Generic election reference without DP/month metadata is ignored. Adjustment verification returns early |
| COBRA `execute`/`verifyEntry` | Discovers current/ever-billed cases; groups on `billingMonth`, requires case/tier metadata. Similar reversal/reinstatement and **nonzero rate-drift reporting, not automatic repricing**. Missing election/rate is not free coverage. A generic WMB/election reference does not work |
| EE contribution `execute`/`verifyEntry` | Reads plugin+config entries; requires subscriber/policy/benefit/month metadata, groups attribution and EA, appends rate corrections/reversals and handles account/policy reassignment. Config-wide transaction lock covers direct writes. Closest existing ordinary net-reconcile model, but no evidence yet that source rows can populate its identity |

Thus a universal “changed expected amount always posts a delta” rollout for DP or
COBRA would change their **existing** policy and is outside this recommendation.
Their arithmetic can be represented by the proposed contract, but enabling such
repricing needs separate policy approval. Missing/ambiguous price is **blocked**,
not an expected total of zero.

### Minimum first-family support, not a rewrite of all plugins

For hourly only, introduce a storage-level group read scoped by plugin, C, EA,
`hour`/`hour_adjustment` and monthly hours ID, returning all posted/pending members
once. The loader has already classified each base, so the plugin asks for **ordinary
owned entries**, not S1 history. Existing fields express this first family's unit;
a universal new billing-unit schema or rules UI is not justified yet.

Expose a shared append-only reconciliation operation: for proven expected amount
`E`, parse every signed amount into integer cents, compute `N = Σ(member cents)`
and `D = E − N`; no operation if `D = 0`, otherwise append `D`. Presence is
`members.length > 0`, not “canonical base key exists.” Keep all bases and adjustments
for an attributed unit, including zero applicability; no blanket deletion. The
group reader, summation and membership rules must be shared with verification.
Do not treat old adjustment metadata as source ownership.

Lock unit (or config) from read through posted ledger commit. Timestamp-suffixed
keys are not a concurrency control. Pending collector entries must be included
exactly once, and the lock may not be released while a required adjustment remains
only queued in memory. Either persist this reconciliation inside the bound
transaction or explicitly keep the collector's group lock until its flush commits.
Share the same locking protocol with loader sync and attribution conversion;
the migration process's advisory lock alone does not serialize web recalculation.
Failure to persist leaves the unit retryable and the run failed, not successful.

## 5. Representation: separate source ownership from billing ownership

This is a **proposed first-family shape**, conditional on source evidence and
approval; no schema or data has been changed:

* Runtime fields: native plugin ID, approved config ID, validated `hour` reference
  and EA. Keep each row's `ar-<ledger_id>` key, **not** `C:EA:hoursId`.
* Preserve ledger UUID, amount, date, statement date, memo and raw S1 key/JSON.
  Do not change historical dates to force unit membership: statement month is
  currently LA month of posting epoch, which need not be the service month.
* Retain existing `data.source`, `s1LedgerId`, `s1Key`, `s1ReferenceNid`, `s1Json`.
  Add protected source-instance/table identity and attribution rule/version,
  decision/checkpoint and resolved unit/config facts separately from raw S1 JSON.
  Native adjustments get normal runtime metadata and optional base links, **never**
  the source-row identity marker. No credentials or participant payload copies.
* Make source identity independently unique across all runtime owners, preferably
  with a persistent partial unique index over the protected source-instance/table/ID
  fields. The current unique `(charge_plugin, charge_plugin_key)` is insufficient
  across ownership changes. Index shape/backfill/legacy-null handling must be
  reviewed before implementation; legacy rows must first be proven one-per-source.
  An explicit source sidecar is an alternative if additional identity cardinality
  is demonstrated, not a prerequisite for this first family.
* `id_map(entity='ledger-ar')` continues to map source ID to ledger UUID, but cannot
  be the sole source of ownership: staging may be rebuilt or an entry restored.
  Recover by persistent source identity and cross-check key/UUID/provenance.
  Conflicts/multiple matches fail closed, never overwrite the “first” match.
* Immutable means **native billing cannot mutate the imported fact**. During the
  agreed S1-wins synchronization phase, the authorized loader may still update or
  remove its source-derived base. Raw source contents may evolve; source identity
  does not. Audit old/new source snapshots through existing approved storage
  logging rather than inventing an unbounded raw-payload history.

Guard shared `entries.update`, `delete`, `deleteByReference`,
`deleteByChargePluginKey`, orphan sweeps and `bulkCreate` (which performs
`ON CONFLICT DO UPDATE`) paths, plus payment-related
cascades. A guard must refuse and roll back, not silently skip deletion and let
native code post a replacement on top. The loader's authorization is narrow and
cannot be inferred from plugin ID, user-provided JSON, suppression flags alone,
or “maintenance” mode. Premium files and any settled/allocated dependencies
need explicit preflight protection before later families can adopt this model.

### Transition from the hourly exception

Do not ship a state where an imported row has C set and is still eligible for the
old hourly `s1-import` scan. Do not count it once via native group membership and
again via an imported-history addend. A source-ID union alone does not resolve
two different ledger rows claiming the same source: that is a blocker.

Deploy reader/provenance support first with execution held for the conversion
scope. Classify and convert **whole proven billing units**, preserving IDs/amounts.
Under one transaction/fence, stamp all accepted members and switch that unit's
reader mode. Compatibility may live in one shared migration/group adapter only;
no new per-plugin S1 search branches. Old broad hourly discovery must not run
concurrently with the new config-aware path. Multi-config units cannot share the
same imported base by default. If dual-reader support would be riskier than a
maintenance window, choose the bounded window.

When native duplicates/offsets already exist, include them in the conversion
inventory and freeze both the old and new group member sets under the lock.
Conversion itself posts nothing and moves no amounts. Preserve membership of
prior corrections; no reassignment to a new config/EA while offsets remain attached
to the old one. An approved reconciliation may subsequently correct the net.
Mixed already-attributed and legacy units must report separately until conversion
finishes; do not subtract an aggregate legacy total from a native total.

## 6. Source sync versus post-import adjustments

These are different authorities, not two ways to edit the same row:

1. **S1-wins dual run:** source bases mirror cleared staged AR, native billing stays
   suppressed during the fleet. T18 verifies source facts only. Native adjustments,
   if historically present, remain untouched. Detect changed member sets and mark
   old/new units dirty; do not silently run billing as part of parity.
2. **Approved S2 billing handoff:** after the agreed source checkpoint, ordinary
   recalculation may append deltas against the attributed bases. Disable source
   ownership updates for handed-off units, or explicitly authorize the guarded
   continuing-sync mode below. Never let a later sync erase S2 adjustments.
3. **If continuing S1 sync after S2 adjustments is required:** approved, serialized
   source updates change only source bases, preserve native adjustments, invalidate
   both affected groups, and require a separate permitted reconciliation before
   declaring runtime convergence. A temporary different runtime net is not a
   source-parity defect. If that atomic/handoff workflow is unavailable, refuse
   source edits/deletes on adjusted units for operator review.

A source reference/account/config remap can affect **two** units. Invalidate old
and new fingerprints/dependency digests, verify source parity separately, and
reconcile both only with approval. Never repair by transferring old adjustments
to a different person/account. Corrected historical financial links retain their
existing evidence-hash approval process. Disable/re-enable/config changes likewise
require an explicit ownership decision, not silently picking a new surviving C.

Source hashes omit config changes, changed crosswalks and target restoration.
Fast paths must prove destination existence, protected identity, attribution version
and current dependency agreement. T18 already reads destination rows even for
source-unchanged records; retain that property after changing its ownership predicate.
Only advance fingerprints after source verification; a new transform version must
be bumped in **both** loader and `sync-config.ts`. Validate target source set and
member digest after restore; matching count or consumed hash is insufficient.
Native adjustment restoration must be checked too, not automatically replayed.

## 7. Cent-exact worked outcomes

These are **arithmetic acceptance examples only**, not claimed source values, keys,
rates or evidence. All numbers below are integer cents; payment allocations are
excluded. `I` = proven imported bases, `B` = native bases, `A` = all prior native
adjustments. Each group has one approved plugin/C/EA/unit. Expected `E` is supplied
by unchanged policy, not inferred from the historical sum.

| Scenario | Before: I; B; A | E | N | Append D = E − N | After N | Repeat D |
|---|---|---:|---:|---:|---:|---:|
| Unchanged, multiple historical rows/payperiods | +10,001 +9,999; none; none | 20,000 | 20,000 | 0 | 20,000 | 0 |
| Edit after that no-op | +10,001 +9,999; none; none | 23,457 | 20,000 | +3,457 | 23,457 | 0 |
| Edit back after the preceding adjustment | +10,001 +9,999; none; +3,457 | 20,000 | 23,457 | −3,457 | 20,000 | 0 |
| Imported rows plus accidental full native duplicate and existing adjustment | +10,001 +9,999; +20,000; −2,500 | 20,000 | 37,500 | −17,500 | 20,000 | 0 |
| Duplicate already corrected: do not “repair” it again | +10,001 +9,999; +20,000; −20,000 | 20,000 | 20,000 | 0 | 20,000 | 0 |
| Signed source correction included, not abs() | +12,345 −2,345; none; none | 10,000 | 10,000 | 0 | 10,000 | 0 |
| Negative net historical correction requires positive delta | +1,000 −1,500; none; none | 0 | −500 | +500 | 0 | 0 |
| Charge ceases to apply after an earlier edit | +10,001 +9,999; none; +3,457 | 0 | 23,457 | −23,457 | 0 | 0 |
| Charge applies again after preceding zero | +10,001 +9,999; none; +3,457 −23,457 | 18,765 | 0 | +18,765 | 18,765 | 0 |
| Adjustment-only orphan, canonical base absent | none; none; −1,234 | 5,000 | −1,234 | +6,234, **not** a +5,000 base | 5,000 | 0 |

No scenario deletes an imported base. Multiple imported rows never each receive
the full expected amount. Both negative bases and negative adjustments retain their
sign. The zero example is a **proven no-obligation** result, not missing pricing.
For DP/COBRA, nonzero repricing examples are not a promise of current behavior.

**S1-wins edit after a native correction:** I = 20,000, A = −2,000, E = 18,000,
so N = 18,000. S1 changes its base to 19,000. Loader updates I only and passes
source parity at 19,000; runtime N = 17,000. A separately authorized reconcile
appends +1,000, yielding 18,000. Repeated loader sync makes no change to I or A;
repeated reconcile appends 0. If S1 then deletes that row under approved continuing
sync and E is proven 0, remaining adjustments net −1,000, so +1,000 is required.
Source absence alone does not prove E = 0.

**Identity remap decision:** moving a source base of +20,000 from old unit to new
while an old −20,000 correction remains makes the old unit net −20,000 and the new
unit +20,000. Renaming config alone cannot fix this. Hold unless an approved plan
preserves source history and explicitly reconciles both old/new expected totals
under one fence; aggregate zero drift cannot validate the two participants.

## 8. Affected paths and ownership consumers

Repository search of `s1-import`, `s1LedgerId`, `ledger-ar`, plus native plugin
lookup/mutation callers identified the following scope. Re-run that search at
implementation time; this inventory is not a permanent claim about future callers.

| Path | Required contract change / retained responsibility |
|---|---|
| `scripts/s1-migration/stage.ts`; `lib/staging.ts` | Preserve raw source keys/JSON/account/participant/reference/sign and verified extraction evidence; no classification by fixture assumptions. Full raw-AR deletion evidence must precede destructive sync |
| `load-ledger.ts` | Replace owner-specific fetch/adopt/existence, ref-heal/hour-drift scans, source update reconstruction, deletion sweep and per-account verification with persistent source ownership; preserve identity-drift refusal and target-restore checks. Sweep source bases only, never native offsets. Current verify counts **all** `s1-import` rows, not merely `ar-*`; audit foreign prefixes explicitly |
| `lib/idmap.ts`; `lib/sync.ts` | Keep ledger UUID crosswalk independent of runtime plugin; attribution/dependency invalidation and loader logic versions; no first-match recovery on conflicting source identity |
| `load-hours.ts`; `repair-hour-links.ts`; `lib/repair-hour-links-persist.ts` | Preserve many-to-one payperiod crosswalk/retirement and month validation; repair profile/link/duplicate detection currently selects `s1-import`. Old repair must refuse converted units or use shared ownership/group contracts; never invoke execute in dry-run |
| `load-employer-rates.ts` | Existing loader requires one enabled hourly config and loads its single account's rates. Prove how each source account can be priced; additional account/config support would be a separately reviewed scope decision, never rate reuse by assumption |
| `load-payments.ts` | Deletion cascade currently finds only imported payment-reference `ar-*` entries to retire ledger mappings. Use shared source identity for all affected bases, keep foreign allocations separate; maintain payments → hours → ledger order |
| `lib/financial-link-inventory.ts`; `lib/financial-link-repair.ts`; `lib/financial-sync-approval.ts`; `repair-financial-links.ts`; migration-owned `server/plugins/system/oneoff/plugins/s1-migration/payments.ts` | AR inventory currently selects plugin+key and derives source ID from key substring. Use persistent identity and validate UUID/EA/account/source agreement throughout inventory and apply. Keep deterministic evidence-hash approval/revalidation and existing migration-payment write boundary; do not reinterpret authorization as billing approval |
| `verify-balance-parity.ts` | Both forward and ledger-PK reverse scans must cover **all** source-owned bases regardless of plugin, detecting missing/malformed/duplicate provenance, wrong entity/account, extras and sign drift. Native deltas excluded from S1 mirror counts/sums; expose runtime net as a separate diagnostic, never relax zero-cent tolerance |
| `sync-config.ts`; `sync.ts`; `lib/migration-lock.ts` and existing app-write fence | Paired version bump, order, immutable migration-image rollout; hold recalculation until conversion/reconciliation approval. No new schedule or automatic repair step |
| `server/plugins/ledger/charge/{types,registry,executor}.ts`; `charge-config-resolution.ts`; charge collector/cache/listener | Establish typed unit contract for chosen family, identical config resolution, pending-entry membership, serial commit/failure behavior; no registry-level guessing of source family |
| Six BAO plugin files in §3/§4 | Hourly first: remove broad S1 addend and canonical-base-only presence assumption, share full net verification, protect no-applicability path. Others remain unchanged/unsupported until individually approved; do not silently change DP/COBRA repricing |
| `server/storage/ledger.ts`; `shared/schema.ts` | Source uniqueness/access predicates, group read with EA/plugin/type narrowing, mutation/cascade guards, exact cent math. Existing plugin+key unique remains for native idempotency, not source identity |
| `server/storage/sitespecific/bao/premium-files.ts` | Selects native premium plugin and metadata for grouping/settlement. Later premium attribution can expose imported rows to settlement; review existing swept months, group net and allocations before enabling that family |
| `server/modules/ledger/ea.ts`; `server/storage/ledger.ts` classifiers | Keep payment-reference-first classification, statements/invoices/payment history intact. Do not turn an allocation into a charge by renaming its owner |
| `scripts/oneoffs/repair-s1-import-reference-types.ts` | Owner-specific scope; retire/refuse on converted targets or use shared source predicate. It is wet by default unless `--dry-run`: **do not run for discovery** |
| `scripts/s1-migration/dev/smoke-money-sync.ts`; `scripts/oneoffs/{s1-parity-smoke,s1-t16-t19-smoke,ledger-linkage-filters-smoke}.ts` | Future rehearsals/cleanup/assertions assume old owner; must not erase or miss converted bases. Fixtures are mechanics tests, never source evidence |
| `tests/s1-migration/{financial-link-repair,financial-money-loaders}.test.ts`; `tests/sitespecific/bao-hourly-imported-base.test.ts` | Eventual implementation must update existing contract assertions. No new permanent discovery suite is requested or added |
| `scripts/s1-migration/{README,RUNBOOK}.md`; docs `03-transformations.md`, `08-ledger-payment-reconciliation.md` | Update old-owner operator commands, repair compatibility, source/runtime parity split and approved lifecycle only when implementation is authorized |

## 9. Bounded rollout and explicit approval

### Phase A — finish source proof, no money writes

Retain the received Q0–Q4 and F1–F2 evidence; obtain the missing results only after
a separately scoped, approved read-only investigation and sanitized producer review;
complete the exclusive second-pass
classifier and exact unit/config/EA validation. Return family acceptance counts,
unmatched/multi-match counts, multi-source-unit distributions and conflict counts.
Review real variants, not synthetic stand-ins. If evidence is unavailable, this
report and query pack remain a blocked implementation recommendation, not a guess.

### Phase B — approve one family and lifecycle

The decision owner must explicitly approve:

1. The source discriminator/correction contract and historical config crosswalk,
   including whether any negative row is confidently a charge-family correction.
2. The immutable source/provenance representation and uniqueness/index migration.
3. Hourly-only signed-net behavior and native mutation guard; no implicit rollout
   to other plugins or changes to rates/eligibility.
4. The S1-wins cutoff versus continuing-sync protocol, config/remap handling,
   and what to do with units already containing native duplicates or adjustments.
5. Separate authority for implementation, target conversion, optional net
   correction, migration-image deployment and schedule changes. Approving one
   does not approve the others.

### Phase C — implementation proposal, not executed here

1. Add persistent source identity validation/uniqueness and shared source
   selectors; convert all parity/repair consumers to ownership-independent reads
   **before** changing any runtime owner. Fail closed on mixed incompatible versions.
2. Add hourly scoped group reconciliation/verification, append-only handling and
   lock-through-commit behavior; remove broad legacy addition without a double-count
   window. Guards must cover mutation/upsert/cascade paths before imports become
   visible to native update/delete code.
3. **Fresh loads:** attribute only proven eligible rows; retain source-per-row
   keys. Unknown families stay `s1-import`. Maintain suppression and fleet order.
   New classification logic still cannot turn on live recalculation.
4. **Ongoing sync:** find source bases by immutable identity; update/delete only
   under authorized S1-wins protocol, invalidate old/new units, verify source parity,
   preserve native offsets and dirty-unit accounting.
5. **Already-imported target:** read-only plan includes complete affected units,
   members/configs, signed totals, dependency snapshots and existing native
   corrections. Hash approval binds both source and destination state. Revalidate
   under fence, convert only full approved units atomically without amount changes,
   update bookkeeping, and verify source count/cents/identity plus group membership.
   Conflicting provenance, multi-config ambiguity or intervening changes aborts.
6. Rehearse on an approved disposable copy; then independently authorize a small
   real conversion. Obtain separate approval to post any correcting deltas. Old
   binaries/repairs must be blocked from converted targets (capability/version gate).
   Rollback **before money posting** can restore owner metadata with exact evidence;
   after native deltas exist, stop and use a reviewed forward correction, not a
   blind relabel/delete rollback.

### Financially meaningful eventual verification

Use the cent cases in §7 plus these boundary checks, reusing existing tests where
valuable rather than creating a broad permanent discovery suite:

* Import-only, adjustment-only and duplicate-native groups all reconcile/verify;
  unrelated participant/account/config groups retain identical counts and amounts.
* Multi-payperiod source rows aggregate once; negative source corrections included,
  payment allocations and unrelated negative credits excluded.
* Two surviving configs, stale/dangling crosswalk, worker/employer/month mismatch,
  unknown discriminator and ambiguous pricing refuse safely with aggregate reasons.
* Concurrent saves, cron and sync produce one effective delta; collector mode sees
  pending entries once, holds serialization through flush, and persistence failure
  cannot advance success/fingerprints.
* Source amount edit, off-Cleared/deletion, reappearance, payperiod retarget, config
  disable/override, target restore and partial interruption resume safely; prior
  native offsets remain identifiable and never become source bases.
* Global source uniqueness survives runtime ownership changes and staging rebuild;
  forward/reverse parity catches malformed/missing/duplicate provenance independently
  of amount equality. Source parity excludes native adjustments.
* No dry run invokes `execute`, bootstrap or report-writing verification CLIs.
  No-op recalculation does not update historical memo/data just to resemble a
  freshly generated native base.

**Stop:** This report authorizes no implementation, schema migration, ledger
reclassification, historical repair, live recalculation, source modification,
cron change or deployment. The next decision is whether the returned source proof
supports an explicitly bounded hourly implementation and which sync lifecycle to use.

## 10. Discovery checks performed

* Checked SQL relation/column names against current staging declarations and
  `shared/schema.ts`; compared config selection with the executor merge.
* PostgreSQL tokenizer/formatter accepted the eight query blocks; a static
  statement check found no data-write/DDL commands in the original eight blocks.
  The operator subsequently executed the supplied initial pack and returned the
  partial real-stage results recorded in §2, then returned F1/F2. Remaining Q4
  second-result/Q5/Q6/Q7/F3 results are not claimed. Q5/F3 have been disabled
  following failed full-population attempts; a timeout/error is a blocker, not
  permission to remove the bound, modify data or claim successful verification.
* Independently checked all ten integer-cent examples and their second-run zero
  deltas. These calculations prove arithmetic only, not source-family mappings.
* No application code, billing config, schema, data or permanent tests changed.
  No bootstrap, loader, repair, recalculation or deployment was run. No app restart
  is needed for these documentation-only changes. A preview capture was attempted
  but the local server was not listening; no signed-in or rendered UI was verified.
