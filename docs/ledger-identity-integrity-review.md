# Ledger identity integrity review

## Scope and authorization

This is a **read-only procedure, not a repair**. No remote queries or historical
data writes were performed for this change. Production impact is **unverified**.
Run only on an explicitly authorized snapshot or environment. Use a dedicated
read-only database role, a consistent snapshot, and bounded query timeouts.
Do not export names, contact details, raw entity identifiers, provider references,
log arguments, consent, metadata contents, or credential-bearing configuration.
The companion `ledger-identity-review.sql` emits aggregate counts only. Small
counts may still need restricted handling. Keep individual investigations in an
approved restricted workspace; do not paste underlying records into tickets.

## Contract and implementation inventory

| Surface | Confirmed behavior and boundary |
| --- | --- |
| `shared/schema.ts` (`ledgerEa`, account/payment/attempt declarations) | EA identity is the exact stored `entityType`, `entityId`, `accountId` triple, permanent from insertion. Currency is the exact stored account `currencyCode`, permanent from insertion. No normalization of legacy spellings. `data`, account name/description, activation, Sirius ID, gateway selection and settings are not identity fields. |
| `server/modules/ledger/ea.ts`, `shared/access-policies/ledger/ea/edit.ts` | PUT authorizes against the **existing** participant first. Staff access or the existing worker/employer/provider policy is still required. Changed identity returns 409 without writing other fields or looking up a destination. Equal echoes are accepted. Create retains its existing authorization. Deletes remain subject to restrictive financial FKs. |
| `server/storage/ledger.ts`, `shared/ledger/immutable-identity.ts` | Runtime storage guards protect internal callers, strip noneditable identity fields from SET, and allow data changes. Account PUT and settings PATCH explicitly reject changed currency rather than silently ignoring it. Storage retains its logging wrapper and normalization of blank external IDs. Missing rows retain existing not-found behavior. |
| `server/storage/ledger/identity-protection.ts` | Row triggers use null-safe exact comparisons; an entire SQL statement fails if any row changes protected values. Unchanged assignments work. ALWAYS triggers also apply in replication mode. Installation is transactional, advisory-serialized, table-locked, idempotent, bounded, and safe with either table absent. There is no role, environment, migration or history-dependent exemption. A database owner capable of changing DDL can remove any database protection; the guarantee is against UPDATE, not hostile superuser DDL. |
| `shared/components.ts`, `server/app-init.ts`, `server/modules/components.ts`, `scripts/migrate/core/1206_lock_ledger_identity.ts` | Ledger is **not** `managesSchema`; its tables use core schema management. Consequently these protections use a core upgrade migration, a post-bootstrap installer before routes/crons, and installation before enabling Ledger. This avoids converting Ledger into a schema-managed component or changing table ownership. Core bootstrap can stamp migrations already applied, so the boot installer is necessary. Disabling Ledger does not remove these core tables/triggers. Repeated installation also repairs recreated tables before access is enabled. No unrelated component push change is necessary. |
| Worker/employer Accounts, `ea-view.tsx`, `config/ledger/accounts.tsx`, `config/ledger/account-edit.tsx` | Worker/employer forms create links with fixed participant identity and a selected parent account. EA detail is read-only. Account create selects a currency; account edit displays it as text, not an editable selector. No EA ownership editor was found or added. |
| `scripts/s1-migration/lib/financial-link-repair.ts`, `load-ledger.ts`, `load-payments.ts` | Source-proof reconciliation gets/creates a canonical EA and changes **transaction links** using entries.update and payments.updateForMigration. It does not rewrite EA identity. Its source proof, fact checks, transaction and suppressions are intentionally preserved. No repair or daily sync was executed. |

## Related exposure: findings, not automatic conclusions

### Manual payment reattribution is still an intended capability

`server/modules/ledger/payments.ts` PUT is staff-gated; it validates the effective
payment type, primary EA, proposed allocations and same-account allocation
destinations, runs charge plugins and writes transactionally.
`client/src/components/ledger/PaymentForm.tsx` offers participant/statement
allocation editing, including choosing the first participant as primary.
`server/storage/ledger.ts` permits ordinary manual payment `ledgerEaId` changes
with payment-type/account currency checks. Provider-managed payments identified
by `details.paymentAttemptId` remain guarded from ordinary edits/deletes.
`updateForMigration` deliberately permits source-reviewed link corrections.

These are not EA ownership edits. They can change which person receives a manual
payment's credit, including after clearing, so a policy decision is still needed
about approval, acceptable evidence and audit/reversal requirements. Do not lock
all payment links or allocations as a side effect of this task. A legitimate
allocation to someone other than the primary payer is not automatically fraud.

### External identifiers and gateway routing remain mutable

`server/modules/ledger/accounts.ts`, `server/storage/ledger.ts`, and the account
edit page allow changes to `siriusId` and `gatewayConfigId`. Sirius IDs are unique
when present; blanks normalize to NULL. Account names/settings/activation remain
editable. External mapping is not evidence of permanent business identity:
changing an ID can affect import lookup; changing a gateway can affect future
provider routing. `server/modules/ledger/payment-gateway-context.ts` resolves
gateway configuration; payment attempts retain their own gateway snapshot in
`ledger_payment_attempts`. A different current gateway can be intentional and
does not prove an old attempt was routed incorrectly. Review account audit
history and source mappings before deciding any correction.

### EA lookup and uniqueness do not agree

`ledgerEa` has UNIQUE(account_id, entity_id), **without entity_type**.
`createLedgerEaStorage().getByEntityAndAccount` and `getOrCreate` search all
three coordinates. An ID reused by different entity types in one account can
therefore conflict at INSERT and fail the subsequent type-specific lookup.
Immutability neither fixes nor worsens that historical schema choice; it must
not be bypassed to relabel the colliding row. Changing the constraint or
normalizing `provider`, `trust_provider`, and `trustProvider` requires separate
compatibility review. Read/display/policy paths currently recognize different
subsets of these spellings (`ea.ts`, `EALayout`, EA view/edit policies).
The companion query reports spelling distribution without changing it; that
distribution alone cannot prove wrong attribution or a past collision.

### Attempt context mismatch is evidence to investigate, not an owner repair plan

`server/storage/ledger/payment_attempts.ts` derives account/entity context at
creation; attempts also retain currency, gateway, amount and statement selection.
Compare retained attempt context to its referenced EA and account, and compare
the linked payment's primary EA to the attempt. A mismatch may reflect a past EA
change, a transaction repair, an earlier bug, or incomplete/legacy context.
Even a matching current snapshot does not prove identity never changed away and
back. Never select an owner from amounts, names, matching balances, or the most
recent mutable external ID.

## Available historical evidence and limits

* `server/storage/database.ts` constructs EA and ledger-entry storage **without**
  logging configs. `server/storage/system/entity-metadata-policy.ts` excludes
  `ledger_ea` and `ledger` from record metadata. There is no promised EA
  before/after audit trail or revision history. A timestamp is not owner evidence.
* Account/payment storage **does** have mutation logging configs in
  `server/storage/ledger.ts`. The shared middleware records `meta.before`,
  `meta.after`, `meta.changes`, arguments, operation, actor and time on successful
  audited calls. Failed calls can also be logged, so filter for successful
  before/after evidence rather than counting every update as a mutation.
  `ledger_accounts` uses raw before/after state by default.
* `winston_logs` retention, historical logging configuration, sampling, direct
  SQL writes and historical application versions limit completeness.
  `entity_metadata` is current provenance, not a full prior-value history.
  Old request logs may show a proposed payload, not that it committed.
* The read-only SQL counts retained EA update log candidates separately from
  records with complete comparable identity snapshots. No candidates is **not**
  proof of no changes. Raw legacy logs may contain sensitive data; only inspect
  them with additional authorization. Never export their whole JSON payload.
* Source migration staging/ID-map evidence and dated backups may establish
  coordinates at a point in time. Retained financial-link review reports must
  still be validated against their source-proof scope; hashes or present
  balances alone do not establish an original owner.

## Review procedure and decisions

1. Obtain approval naming environment/snapshot, reviewer and retention limits.
   Do not infer production-query approval from this implementation task.
2. Inspect table availability and run the companion aggregate script with
   `psql -X --set=ON_ERROR_STOP=1 --file=docs/ledger-identity-review.sql`
   using an approved connection configured outside this document. It starts
   READ ONLY and rolls back. A missing table is explicitly skipped.
3. Confirm trigger installation, counts of mismatched attempt snapshots, provider
   payment-link discrepancies, type spellings, mapping/routing changes and
   retained comparable audit evidence. These are triage counts, not repair counts.
4. If needed, separately authorize restricted per-record review of exact EA and
   transaction IDs, source ID maps, dated snapshots and successful audits.
   Document what evidence establishes each coordinate and what remains unknown.
5. Separate (a) a confirmed EA identity change, (b) an intended transaction-link
   correction/allocation, (c) an intentional mapping/routing change, and
   (d) an unresolved discrepancy. Record evidence gaps and do not infer causation
   from a current mismatch.
6. Agree separately on manual-payment correction policy, external-mapping review,
   and polymorphic uniqueness compatibility. Any historical correction needs an
   approved record-specific plan and preservation checks. Do not create a
   reparent endpoint, grant an admin exception, delete/recreate history, or
   automatically repair uncertain ownership.

## Verification boundaries

Disposable PostgreSQL tests exercise the production installer, real storage and
HTTP handlers with fixture-only auth, direct writes, concurrent attempts and
reinstallation. They preserve attached charges/payments/balances/attempt context
on refusal and exercise permitted transaction-link edits. Existing source-proof
repair and payment-allocation suites remain the authority for their workflows.
Help checks use real registration, path matching and sanitization without
modifying local entries. Authenticated app/help-dialog rendering requires a
signed-in session and is not proven by the route harness or public screenshot.

Verification performed on 2026-10-30:

* New identity, audit-middleware, and help suites pass (38 assertions/tests).
  Aggregate review SQL was executed only against disposable PostgreSQL.
* The broader ledger run plus financial-link repair and migration checks passed
  499 tests across 48 files. Four existing suites failed: credit-posting mocks
  omit `claimLedgerPosting`; worker-payable mocks lack the required financial
  payment type; invoice-balance mocks omit `useEALayout`; the attachment
  migration suite still names a retired migration filename. The same 14 failures
  and one suite-load failure reproduced on the unchanged base in a separate
  temporary worktree. They were not repaired as part of identity enforcement.
* The development upgrade migration succeeded; a subsequent boot with the
  version already applied also reached “Application fully initialized and ready”.
  A public account-page screenshot showed the expected sign-in screen.
  Signed-in account pages, `/config/helps`, and the opened Help dialog were
  **not** visually verified. Local help rows were not edited.
