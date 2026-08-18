# 08 — Ledger/payment reconciliation kit (rehearsal → production gate)

Purpose: reconcile the S1 money streams (AR ledger + payments) against S2 on
the rehearsal database, root-cause every payment that failed to import, and
verify reference linkage end-to-end — separating tooling artifacts from true
data drift before the production run.

**Execution model (ruling, 2026-08-18):** the workspace has no access to the
rehearsal database (HIPAA boundary — it lives in-VPC; DSN only in AWS Secrets
Manager). All target-database steps are **operator-run**: SQL is pasted into
the Neon SQL editor connected to the rehearsal DB, harness/repair scripts run
as ECS one-off tasks per the RUNBOOK/FC conventions, and S1-side confirmations
run in the CloudShell **VPC tab**. Aggregate outputs are pasted back for
triage.

**Sanitization bar (unchanged):** this file and everything committed carry
aggregate counts and reason codes only — no production nids, no dollar
amounts, no hostnames. Query *outputs* that contain raw nids (marked ⚠ below)
are for chat paste-back only; never commit them.

---

## 1. Recorded rehearsal state (evidence basis)

From the recorded loader runs (`s1_staging.runs`) on the rehearsal target:

- **t19-payments** — two identical 8/8 runs. Staged 3,458; rejects **150**:
  `amount_missing 102, payer_ref_missing 40, status_missing 3,
  account_unensured 3, date_missing 1, payment_type_missing 1`.
  Expected loaded (created+adopted): **3,308**.
- **t18-ledger** — 8/8, **zero rejects**, built-in per-account count+sum
  verify passed on every account.
- **No balance-parity run** has been recorded against the rehearsal target
  yet — running it is step OP-3 below.
- ~~The rehearsal load ran before the reference-type vocabulary fix~~
  **Corrected 2026-08-18:** R5c returned 0/0 — the rehearsal load already
  used the runtime vocabulary, so the OP-2 repair was a no-op. The linkage
  problem that DID surface is a run-order artifact — see §9.3.

---

## 2. Operator procedure (run in this order)

**OP-0 — prerequisites.** The ECS one-off image must be built from a bao-dev
revision that includes the reference-type fix and
`scripts/oneoffs/repair-s1-import-reference-types.ts` (the image pins source
at build time — rebuild if in doubt).

**OP-1 — sanity.** Run **R0** in the Neon SQL editor against the rehearsal
DB. `db` must be the rehearsal database and `staged_payments` ≈ 3,458. If it
shows dev-scale counts (~30), you are connected to the wrong database — stop.

**OP-2 — repair reference types.** ECS one-off, per RUNBOOK conventions:

```bash
npx tsx scripts/oneoffs/repair-s1-import-reference-types.ts --dry-run   # counts only
npx tsx scripts/oneoffs/repair-s1-import-reference-types.ts            # real run
```

Verify with **R5c** (both counts must be 0 after) and **R5a** (types now
`payment`/`wmb`/`s1-unknown`/...). Idempotent; batched; touches only
`charge_plugin='s1-import'` rows.

**OP-3 — balance parity, bare run.** ECS one-off:

```bash
npx tsx scripts/s1-migration/verify-balance-parity.ts
```

No `--allow-mismatches`, no `--tolerance-cents` on the first run — we want
the full mismatch census. Expect **FAIL** (see §6 for the predicted classes);
capture the JSON report (it is aggregate-only by design) and paste it back.
The report also lands in `s1_staging.runs` (readable later via **R1**).

**OP-4 — target-DB query pack.** Run **R1–R7b** (§3) in the Neon SQL editor;
paste back all outputs. R4b/R4c/R6c outputs carry raw nids — chat only.

**OP-5 — S1-side confirmations.** In CloudShell (**VPC tab** — the regular
tab cannot reach MariaDB), run **M1–M3** (§4). M2 needs the nid list from
R6c pasted in.

Paste-back checklist: §7.

---

## 3. R-series — target Postgres (Neon SQL editor)

Every query below was validated verbatim against the dev database
(2026-08-18, zero failures). They are read-only.

### R0 — sanity: confirm you are on the rehearsal DB

```sql
SELECT current_database() AS db,
  (SELECT count(*) FROM s1_staging.records WHERE bundle = 'sirius_payment')          AS staged_payments,
  (SELECT count(*) FROM s1_staging.raw_ledger_ar)                                    AS staged_ar_rows,
  (SELECT count(*) FROM ledger          WHERE charge_plugin = 's1-import')           AS s1_import_ledger_entries,
  (SELECT count(*) FROM ledger_payments WHERE details->>'source' = 's1-migration')   AS s1_migration_payments;
```

### R1 — recorded run reports (t19 / t18 / parity)

```sql
SELECT id, started_at,
       COALESCE(args->>'loader', args->>'harness', report->>'loader', report->>'harness') AS which,
       report->>'staged'         AS staged,
       report->>'created'        AS created,
       report->>'adopted'        AS adopted,
       report->>'verifyFailures' AS verify_failures,
       report->'rejects'         AS rejects
  FROM s1_staging.runs
 WHERE COALESCE(args->>'loader', args->>'harness', report->>'loader', report->>'harness')
       IN ('t19-payments', 't18-ledger', 'verify-balance-parity')
 ORDER BY id DESC
 LIMIT 12;
```

### R2 — payment count reconciliation: staged vs id_map vs loaded

Gate: `id_mapped == loaded == staged − total rejects` (3,308 expected) and
`loaded_without_nid = 0`.

```sql
SELECT
  (SELECT count(*) FROM s1_staging.records WHERE bundle = 'sirius_payment')          AS staged,
  (SELECT count(*) FROM s1_staging.id_map  WHERE entity = 'payment')                 AS id_mapped,
  (SELECT count(*) FROM ledger_payments    WHERE details->>'source' = 's1-migration') AS loaded,
  (SELECT count(*) FROM ledger_payments p
    WHERE p.details->>'source' = 's1-migration'
      AND (p.details->>'s1Nid') !~ '^[0-9]+$')                                        AS loaded_without_nid;
```

### R3 — staged missing-field profile (mirrors t19 reject precedence)

Reproduces the recorded reject counts from staged data alone. The CASE chain
uses the loader's first-match order (status → amount → date → account → payer
→ type), so each row lands in exactly one bucket, same as the RejectLog.
Gate: buckets match §1 exactly; `(all required fields present)` =
3,308 + account_unensured (3) = 3,311.

```sql
WITH p AS (
  SELECT nid,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_payment_status') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_payment_status'->0) = 'object'
             THEN fields->'field_sirius_payment_status'->0->>'value'
             ELSE fields->'field_sirius_payment_status'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_payment_status') = 'object'
           THEN fields->'field_sirius_payment_status'->>'value'
      ELSE fields->>'field_sirius_payment_status' END), '') AS status,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_dollar_amt') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_dollar_amt'->0) = 'object'
             THEN fields->'field_sirius_dollar_amt'->0->>'value'
             ELSE fields->'field_sirius_dollar_amt'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_dollar_amt') = 'object'
           THEN fields->'field_sirius_dollar_amt'->>'value'
      ELSE fields->>'field_sirius_dollar_amt' END), '') AS amt,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_datetime_created') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_datetime_created'->0) = 'object'
             THEN fields->'field_sirius_datetime_created'->0->>'value'
             ELSE fields->'field_sirius_datetime_created'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_datetime_created') = 'object'
           THEN fields->'field_sirius_datetime_created'->>'value'
      ELSE fields->>'field_sirius_datetime_created' END), '') AS dt,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_ledger_account') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_ledger_account'->0) = 'object'
             THEN COALESCE(fields->'field_sirius_ledger_account'->0->>'target_id',
                           fields->'field_sirius_ledger_account'->0->>'value')
             ELSE fields->'field_sirius_ledger_account'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_ledger_account') = 'object'
           THEN COALESCE(fields->'field_sirius_ledger_account'->>'target_id',
                         fields->'field_sirius_ledger_account'->>'value')
      ELSE fields->>'field_sirius_ledger_account' END), '') AS acct,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_payer') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_payer'->0) = 'object'
             THEN COALESCE(fields->'field_sirius_payer'->0->>'target_id',
                           fields->'field_sirius_payer'->0->>'value')
             ELSE fields->'field_sirius_payer'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_payer') = 'object'
           THEN COALESCE(fields->'field_sirius_payer'->>'target_id',
                         fields->'field_sirius_payer'->>'value')
      ELSE fields->>'field_sirius_payer' END), '') AS payer,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_payment_type') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_payment_type'->0) = 'object'
             THEN COALESCE(fields->'field_sirius_payment_type'->0->>'tid',
                           fields->'field_sirius_payment_type'->0->>'value')
             ELSE fields->'field_sirius_payment_type'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_payment_type') = 'object'
           THEN COALESCE(fields->'field_sirius_payment_type'->>'tid',
                         fields->'field_sirius_payment_type'->>'value')
      ELSE fields->>'field_sirius_payment_type' END), '') AS ptype
  FROM s1_staging.records
  WHERE bundle = 'sirius_payment'
)
SELECT CASE
    WHEN status IS NULL THEN 'status_missing'
    WHEN amt    IS NULL THEN 'amount_missing'
    WHEN dt     IS NULL THEN 'date_missing'
    WHEN acct   IS NULL THEN 'account_ref_missing'
    WHEN payer  IS NULL THEN 'payer_ref_missing'
    WHEN ptype  IS NULL THEN 'payment_type_missing'
    ELSE '(all required fields present)'
  END AS first_missing, count(*) AS n
  FROM p
 GROUP BY 1
 ORDER BY n DESC;
```

### R4a — amount_missing drilldown: S1 status distribution

The disposition hinges on this: amount-less **Canceled/Failed** payments are
plausibly acceptable-as-is (no money at stake); amount-less **Cleared** rows
are true drift needing a fund ruling.

```sql
WITH p AS (
  SELECT nid,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_payment_status') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_payment_status'->0) = 'object'
             THEN fields->'field_sirius_payment_status'->0->>'value'
             ELSE fields->'field_sirius_payment_status'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_payment_status') = 'object'
           THEN fields->'field_sirius_payment_status'->>'value'
      ELSE fields->>'field_sirius_payment_status' END), '') AS status,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_dollar_amt') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_dollar_amt'->0) = 'object'
             THEN fields->'field_sirius_dollar_amt'->0->>'value'
             ELSE fields->'field_sirius_dollar_amt'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_dollar_amt') = 'object'
           THEN fields->'field_sirius_dollar_amt'->>'value'
      ELSE fields->>'field_sirius_dollar_amt' END), '') AS amt
  FROM s1_staging.records
  WHERE bundle = 'sirius_payment'
)
SELECT COALESCE(status, '(status also missing)') AS s1_status, count(*) AS n
  FROM p
 WHERE amt IS NULL AND status IS NOT NULL
 GROUP BY 1
 ORDER BY n DESC;
```

### R4b — payer_ref_missing drilldown ⚠ (output carries nids — chat only)

```sql
WITH p AS (
  SELECT nid,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_payment_status') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_payment_status'->0) = 'object'
             THEN fields->'field_sirius_payment_status'->0->>'value'
             ELSE fields->'field_sirius_payment_status'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_payment_status') = 'object'
           THEN fields->'field_sirius_payment_status'->>'value'
      ELSE fields->>'field_sirius_payment_status' END), '') AS status,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_payer') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_payer'->0) = 'object'
             THEN COALESCE(fields->'field_sirius_payer'->0->>'target_id',
                           fields->'field_sirius_payer'->0->>'value')
             ELSE fields->'field_sirius_payer'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_payer') = 'object'
           THEN COALESCE(fields->'field_sirius_payer'->>'target_id',
                         fields->'field_sirius_payer'->>'value')
      ELSE fields->>'field_sirius_payer' END), '') AS payer
  FROM s1_staging.records
  WHERE bundle = 'sirius_payment'
)
SELECT COALESCE(status, '(status missing)') AS s1_status, count(*) AS n,
       array_agg(nid ORDER BY nid) FILTER (WHERE payer IS NULL) AS sample_nids
  FROM (SELECT * FROM p WHERE payer IS NULL LIMIT 1000) q
 GROUP BY 1
 ORDER BY n DESC;
```

Note: `payer_ref_missing` means the payer field is **absent on the staged
node** (S1 payments saved without a payer) — not an unresolved reference.
The deleted-node hypothesis applies to `payer_unmapped` (0 in rehearsal), so
the fix path here is S1 data cleanup or an allow-reject, not id_map work.

### R4c — account_unensured drilldown ⚠ (output carries account nids)

Rows with `staged_as_account = false` are payments referencing an account nid
that was never staged as `sirius_ledger_account` — matches the N6 dry-run
finding of a dangling payment→account reference.

```sql
WITH p AS (
  SELECT nid,
    NULLIF(TRIM(CASE
      WHEN jsonb_typeof(fields->'field_sirius_ledger_account') = 'array' THEN
        CASE WHEN jsonb_typeof(fields->'field_sirius_ledger_account'->0) = 'object'
             THEN COALESCE(fields->'field_sirius_ledger_account'->0->>'target_id',
                           fields->'field_sirius_ledger_account'->0->>'value')
             ELSE fields->'field_sirius_ledger_account'->>0 END
      WHEN jsonb_typeof(fields->'field_sirius_ledger_account') = 'object'
           THEN COALESCE(fields->'field_sirius_ledger_account'->>'target_id',
                         fields->'field_sirius_ledger_account'->>'value')
      ELSE fields->>'field_sirius_ledger_account' END), '') AS acct
  FROM s1_staging.records
  WHERE bundle = 'sirius_payment'
)
SELECT x.acct::bigint AS account_nid,
       count(*)       AS payments_referencing,
       EXISTS (SELECT 1 FROM s1_staging.records a
                WHERE a.bundle = 'sirius_ledger_account' AND a.nid = x.acct::bigint) AS staged_as_account
  FROM p x
 WHERE x.acct ~ '^[0-9]+$'
 GROUP BY x.acct
 ORDER BY staged_as_account ASC, payments_referencing DESC
 LIMIT 25;
```

### R5a — s1-import ledger entries by reference type

After OP-2 the types must be runtime vocabulary (`payment`, `wmb`, `worker`,
`contact`, ... , `s1-unknown`) — no `ledger_payment` / `trust_wmb` rows left.

```sql
SELECT COALESCE(reference_type, '(null)') AS reference_type, count(*) AS entries
  FROM ledger
 WHERE charge_plugin = 's1-import'
 GROUP BY 1
 ORDER BY entries DESC;
```

### R5b — payment-referenced entries join to real ledger_payments

Gate: `dangling = 0` and `linked_to_migrated_payment = entries`.

```sql
SELECT l.reference_type,
       count(*)                                                        AS entries,
       count(p.id)                                                     AS linked_to_real_payment,
       count(*) FILTER (WHERE p.details->>'source' = 's1-migration')   AS linked_to_migrated_payment,
       count(*) - count(p.id)                                          AS dangling
  FROM ledger l
  LEFT JOIN ledger_payments p ON p.id = l.reference_id
 WHERE l.charge_plugin = 's1-import'
   AND l.reference_type IN ('payment', 'ledger_payment')
 GROUP BY 1;
```

### R5c — repair preflight/verify

Before OP-2: shows the volume the repair will touch. After OP-2: both = 0.

```sql
SELECT count(*) FILTER (WHERE reference_type = 'ledger_payment') AS old_payment_vocab,
       count(*) FILTER (WHERE reference_type = 'trust_wmb')      AS old_wmb_vocab
  FROM ledger
 WHERE charge_plugin = 's1-import';
```

### R6a — s1-unknown residuals: volume

```sql
SELECT count(*)                                       AS entries,
       count(DISTINCT reference_id)                   AS distinct_nids,
       count(*) FILTER (WHERE amount::numeric < 0)    AS negative_entries,
       count(*) FILTER (WHERE amount::numeric >= 0)   AS nonnegative_entries
  FROM ledger
 WHERE charge_plugin = 's1-import' AND reference_type = 's1-unknown';
```

### R6b — s1-unknown classification: loader gap vs deleted source

Classification rule (same as §P7): a nid that IS staged in an in-scope bundle
but ended `s1-unknown` = **loader gap** (the id_map should have resolved it);
a nid staged in an out-of-scope bundle = expected (no S2 entity exists for
it); `(not staged)` = deleted in S1 or out of extract scope — confirm with M2.

```sql
WITH u AS (
  SELECT DISTINCT reference_id::bigint AS nid
    FROM ledger
   WHERE charge_plugin = 's1-import'
     AND reference_type = 's1-unknown'
     AND reference_id ~ '^[0-9]+$'
)
SELECT COALESCE(r.bundle, '(not staged: deleted or out-of-scope in S1)') AS staged_bundle,
       count(*) AS distinct_nids
  FROM u
  LEFT JOIN s1_staging.records r ON r.nid = u.nid
 GROUP BY 1
 ORDER BY distinct_nids DESC;
```

### R6c — s1-unknown sample nids for M2 ⚠ (output carries nids)

```sql
WITH u AS (
  SELECT DISTINCT reference_id::bigint AS nid
    FROM ledger
   WHERE charge_plugin = 's1-import'
     AND reference_type = 's1-unknown'
     AND reference_id ~ '^[0-9]+$'
)
SELECT u.nid, COALESCE(r.bundle, '(not staged)') AS staged_bundle
  FROM u
  LEFT JOIN s1_staging.records r ON r.nid = u.nid
 ORDER BY u.nid
 LIMIT 25;
```

### R7a — staged AR rows by S1 status

Non-Cleared rows are intentionally not migrated; production expectation per
Q19 profiling was ~100% Cleared. Any non-Cleared count here must equal the
frozen S1 count (RUNBOOK §4 row 11).

```sql
SELECT COALESCE(NULLIF(TRIM(ledger_status), ''), '(null)') AS s1_status, count(*) AS n
  FROM s1_staging.raw_ledger_ar
 GROUP BY 1
 ORDER BY n DESC;
```

### R7b — loaded s1-import entries: charge/credit split

```sql
SELECT count(*)                                     AS entries,
       count(*) FILTER (WHERE amount::numeric >= 0) AS charge_rows,
       count(*) FILTER (WHERE amount::numeric < 0)  AS credit_rows
  FROM ledger
 WHERE charge_plugin = 's1-import';
```

---

## 4. M-series — S1 MariaDB (CloudShell VPC tab)

### M1 — AR reference targets by live bundle

Attributes every `sirius_ledger_ar.ledger_reference` to its live S1 node
type; the `(deleted)` row is the population that can only ever be
`s1-unknown` in S2. Cross-check: distinct refs per live bundle should roughly
map to R5a's per-type counts (payments dominate).

```sql
SELECT COALESCE(n.type, '(deleted)') AS live_bundle,
       COUNT(DISTINCT a.ledger_reference) AS distinct_refs,
       COUNT(*) AS ar_rows
FROM sirius_ledger_ar a
LEFT JOIN node n ON n.nid = a.ledger_reference
WHERE a.ledger_reference IS NOT NULL AND a.ledger_reference <> 0
GROUP BY n.type
ORDER BY distinct_refs DESC;
```

### M2 — node-existence check for the R6c nid list

Replace the placeholder list with the nids from R6c. `(deleted)` confirms
the residual is a deleted S1 source, not a loader gap.

```sql
SELECT s.nid,
       CASE WHEN n.nid IS NULL THEN '(deleted)' ELSE n.type END AS s1_state
FROM (SELECT 1111111 AS nid
      UNION ALL SELECT 2222222
      /* ...one UNION ALL per R6c nid... */) s
LEFT JOIN node n ON n.nid = s.nid;
```

### M3 — payment field completeness against live S1

Must reproduce R3's staged profile from the live source (proves the gaps are
in S1, not the extract). Independent per-field counts — a row can be counted
in more than one column, so totals can exceed R3's first-match buckets.

```sql
SELECT COUNT(*) AS payments,
       SUM(s.entity_id  IS NULL) AS status_missing,
       SUM(d.entity_id  IS NULL) AS amount_missing,
       SUM(dc.entity_id IS NULL) AS date_missing,
       SUM(a.entity_id  IS NULL) AS account_ref_missing,
       SUM(py.entity_id IS NULL) AS payer_ref_missing,
       SUM(t.entity_id  IS NULL) AS payment_type_missing
FROM node p
LEFT JOIN field_data_field_sirius_payment_status s
       ON s.entity_id = p.nid AND s.bundle = 'sirius_payment' AND s.deleted = 0
LEFT JOIN field_data_field_sirius_dollar_amt d
       ON d.entity_id = p.nid AND d.bundle = 'sirius_payment' AND d.deleted = 0
LEFT JOIN field_data_field_sirius_datetime_created dc
       ON dc.entity_id = p.nid AND dc.bundle = 'sirius_payment' AND dc.deleted = 0
LEFT JOIN field_data_field_sirius_ledger_account a
       ON a.entity_id = p.nid AND a.bundle = 'sirius_payment' AND a.deleted = 0
LEFT JOIN field_data_field_sirius_payer py
       ON py.entity_id = p.nid AND py.bundle = 'sirius_payment' AND py.deleted = 0
LEFT JOIN field_data_field_sirius_payment_type t
       ON t.entity_id = p.nid AND t.bundle = 'sirius_payment' AND t.deleted = 0
WHERE p.type = 'sirius_payment';

-- amount-missing rows by status and created year (disposition driver):
SELECT COALESCE(s.field_sirius_payment_status_value, '(none)') AS status,
       FROM_UNIXTIME(p.created, '%Y') AS yr, COUNT(*) AS n
FROM node p
LEFT JOIN field_data_field_sirius_dollar_amt d
       ON d.entity_id = p.nid AND d.bundle = 'sirius_payment' AND d.deleted = 0
LEFT JOIN field_data_field_sirius_payment_status s
       ON s.entity_id = p.nid AND s.bundle = 'sirius_payment' AND s.deleted = 0
WHERE p.type = 'sirius_payment' AND d.entity_id IS NULL
GROUP BY status, yr
ORDER BY yr, status;
```

---

## 5. Reject root-cause working table (t19, rehearsal)

Hypotheses from recorded evidence + N6 profiling; **final disposition pends
the R/M paste-backs.** Categories match the triage workbook
(`docs/s1-rehearsal-reject-triage.xlsx`).

| Reject reason | Count | Confirming queries | Root-cause hypothesis | Recommended disposition (pending confirmation) |
|---|---|---|---|---|
| `amount_missing` | 102 | R4a, M3 | S1 payments saved without a dollar amount; N6 profiling suggests these skew Canceled/Failed/Pending (no money at stake if so) | If no Cleared rows in R4a: **Acceptable as-is** → allow-reject. Any Cleared rows: **Needs ruling** (money unaccounted) |
| `payer_ref_missing` | 40 | R4b, M3 | Payer field absent on the S1 node (not a deleted-node case — that would be `payer_unmapped`) | **Needs ruling**: S1 data cleanup (assign payer) vs allow-reject; if their statuses are non-Cleared, allow-reject is safe |
| `status_missing` | 3 | R3, M3 | S1 nodes with no payment-status field row | **S1 data cleanup** if Cleared-adjacent money exists; else allow-reject |
| `account_unensured` | 3 | R4c | Payment references an account nid never staged as `sirius_ledger_account` — matches the N6 dangling account ref | **Needs ruling** (likely deleted/legacy account; fund decides whether to recreate or drop) |
| `date_missing` | 1 | R3, M3 | No `datetime_created` field row | **S1 data cleanup** (single row) or allow-reject |
| `payment_type_missing` | 1 | R3, M3 | No payment-type term; loader has deliberately **no fallback type** (forbidden in prod per RUNBOOK §5) | **S1 data cleanup** (assign type) or allow-reject |

Reconciliation identity to verify after paste-back:
`staged (3,458) − Σ rejects (150) = id_mapped = loaded (3,308)` (R2), and R3
buckets must equal the recorded reject counts exactly — any difference means
the staged snapshot changed since the load and the run must be re-verified.

---

## 6. Expected balance-parity outcome (bare run, OP-3)

Derived from the recorded rejects; the harness checks status/amount/account
itself but NOT date/payer/type, so those rejected rows surface as
`payment_missing_in_s2`:

| Mismatch class | Expected count | Source |
|---|---|---|
| `payment_status_missing` | 3 | = t19 `status_missing` |
| `payment_bad_amount` | 102 | = t19 `amount_missing` (harness merges missing+malformed) |
| `payment_account_unmapped` | 3 | = t19 `account_unensured` |
| `payment_missing_in_s2` | 42 | = 40 `payer_ref_missing` + 1 `date_missing` + 1 `payment_type_missing` |
| every `ar_*` class | 0 | t18 loaded 8/8 with built-in per-account verify |
| `payment_extra_in_s2` / `payment_duplicate_in_s2` / `payment_provenance_missing` | 0 | single-source load, provenance stamped |

Drift: any **Cleared** row among the mismatches adds S1-side cents the
S2 side lacks, so the bare run FAILs on drift unless all 150 rejected
payments are non-Cleared. Procedure: triage each class per §5, then rerun

```bash
npx tsx scripts/s1-migration/verify-balance-parity.ts \
  --allow-mismatches <only-the-triaged-classes>
```

and require `driftCents: 0` per account and aggregate, `result: "PASS"`.
Anything still drifting after the allow-list is **true drift → fund ruling**.
Deviations from this table (extra classes, different counts) are exactly the
findings this task exists to catch — paste them back for root-causing.

---

## 7. Paste-back checklist (operator → chat)

1. ~~OP-2 repair~~ done 2026-08-18 (no-op — vocabulary already clean, §9).
2. ~~OP-3 bare parity run~~ done — matched §6 prediction exactly (§9.2).
3. ~~R0–R7b~~ done (nid-bearing outputs stayed in chat).
4. ~~M1/M2~~ moot (zero deleted-node residuals, §9.3); M3 superseded by the
   direct S1 investigation (§9.4).
5. ~~Rerun parity with the triaged allow-list~~ done — **PASS, drift 0**
   (§9.2). Reconciliation closed.

---

## 8. Recommended loader-report counters (before the production run)

Gaps found while building this kit — each forces a manual query today:

1. **t19: `stagedByStatus`** — S1 status distribution of staged payments, so
   reject counts reconcile against staged totals without ad-hoc SQL (R4a
   exists because this is missing).
2. **t19: reject reason × S1 status cross-tab** (`rejectsByStatus`) — the
   disposition decision (money at stake or not) is exactly this table.
3. **t18: `unknownReferenceSummary`** — for `s1-unknown` rows: distinct nid
   count, staged-bundle split (the R6b classification), and a ≤25-nid sample.
   Today `referenceTypes` gives only the total.
4. **t18: post-load linkage gate** — R5b's `dangling` count computed at the
   end of the run (payment-referenced entries that fail to join
   `ledger_payments`), so a vocabulary/linkage regression fails the load
   instead of waiting for parity.

These are report-only additions (no load-path behavior change) and belong to
a follow-up code task, not this reconciliation.

---

## 9. Rehearsal results & triage (2026-08-18)

All R-series queries, the bare parity run, and S1-side investigation are
complete. Aggregates only below; row-level evidence stayed in chat per the
sanitization bar.

### 9.1 Counts & identity

- Staged payments 3,489 (snapshot moved slightly after the recorded load —
  live S1). Rejects 150; id_mapped = loaded = staged − rejects, exactly
  (R2, `loaded_without_nid = 0`). R3 buckets matched the recorded reject
  counts and precedence exactly.
- Three recorded runs: t18 (zero rejects), t19 create run, t19 idempotent
  rerun (all-adopt, identical rejects) — rerun safety confirmed.
- AR: staged = loaded = 264,594; all staged AR rows are Cleared (R7a);
  charge/credit split preserved (R7b).

### 9.2 Balance parity (bare run)

Observed outcome matched the §6 prediction **exactly**: the four predicted
payment classes at the predicted counts (42 / 102 / 3 / 3), no extra
classes, every `ar_*` class 0.

- **AR stream: cents-exact.** Aggregate AR drift 0 across all 264,594
  entries.
- **Payment stream drift is fully attributed** to Cleared money among the
  rejected payments (dominated by the Cleared portion of
  `payer_ref_missing`), concentrated in one account. Closure check
  **confirmed 2026-08-18**: rerun with
  `--allow-mismatches payment_missing_in_s2,payment_bad_amount,payment_account_unmapped,payment_status_missing`
  returned **PASS, drift 0 per account and aggregate** — no true drift; all
  payment-stream discrepancy is attributed to the triaged reject classes.

### 9.3 Reference linkage — root cause: loader run order

R5a showed nearly all `s1-import` entries typed `s1-unknown` (only the
employer-referenced handful resolved). R6a/R6b attribution: **100% of the
distinct reference nids are present in staging** (payperiods ≫ payments ≫ a
few json-definition nodes) — **zero deleted-node residuals**; M1/M2 are moot.

Cause: t18 ran **before** t19 on the rehearsal, so no `payment` id_map
entries existed when t18 resolved references; the WMB loader never ran, so
payperiod references had no `wb` mappings either. The adopt path skips
existing rows without re-resolving, so a t18 rerun does not heal it.

**Production disposition (binding):** load order must place t19-payments
(and the WMB loader, if payperiod linkage is wanted) **before** t18-ledger,
and the production run must gate on the §8.4 post-load linkage counter.
Candidate follow-up: make the t18 adopt path re-resolve `s1-unknown`
references so ordering is self-healing.

### 9.4 Reject dispositions — confirmed (supersedes §5 hypotheses)

Post-rehearsal S1 investigation and cleanup (operator-run, 2026-08-18)
closed every class:

| Reject | Count | Confirmed root cause | Disposition |
|---|---|---|---|
| `amount_missing` | 102 | Overwhelmingly void/draft/cancelled (no money posted). A small Cleared handful: all but one zero-for-zero; the one real payment↔ledger disagreement was corrected in S1 (ledger ruled authoritative) and now migrates. | **Allow-reject** remainder |
| `payer_ref_missing` | 40 → 0 | Dangling payers were deleted S1 test contacts/employers; cleared by the test-data deletion sweep. | **Fixed in S1** |
| `status_missing` | 3 → 0 | Abandoned drafts + one mis-allocated placeholder-payer entry (removed via the app, not by hand). | **Fixed in S1** |
| `account_unensured` | 3 | Adjustment credits against retired ledger accounts; nothing posted. | **Allow-reject** |
| `date_missing` / `payment_type_missing` | 1 each → 0 | Single records, corrected in S1. | **Fixed in S1** |

Net production allow-list: **`amount_missing,account_unensured`** (~104
expected rejects on the post-cleanup rerun; reject counts must be re-verified
after restaging — see the re-run triage task).

Carry-forward observations (fund/workflow questions, not migration blockers):
S1 permits payment and ledger amounts to diverge (S2 prevents structurally);
a placeholder payer has received cleared allocated money at least once; S1
node deletion silently removes ledger rows while the app path cascades
correctly.
