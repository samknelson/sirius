# N6 — Balance-Parity Acceptance Test: Design + Fund Ruling Sheet

**Status: DESIGN COMPLETE — awaiting Laura/Sam sign-off.**

> **Tracked, sanitized copy.** The S1-migration doc set (`docs/s1-migration/`, local-only — it contains live S1 connection details and is excluded from version control by policy) cross-references this document as `08-n6-balance-parity.md`; that file is a pointer here. This copy contains no credentials, no connection details, and no PII — only test design, aggregate dry-run figures, and freeze-day SQL. N6 stays open in the local `06-strategy-revision.md` §8 until the three ruling-sheet items below are ruled; this document is the design being signed off.

All facts here were verified against a **production dry run (2026-02)**; the raw outputs (`Pasted--ledger-participant-*`, `Pasted--ledger-id-*`, `Pasted--payment-nid-*`) are retained **local-only** in the workspace `attached_assets/` directory — they contain production entity ids and payment-level amounts and are deliberately excluded from version control; only the aggregate figures cited in this doc are published. This doc supersedes the local prod query pack's §G (G1–G4 answered; the **N6-1..N6-8** set below is the freeze-day pack). Loader context: T18 (ledger charges) and T19 (payments) in the local `03-transformations.md`; ledger/payment facts in local 06 §4.18.

This is a freeze-day runbook: a reader at freeze time should be able to execute it with no other context.

---

## 1. Test design

### 1.1 Baseline = `sirius_ledger_ar` rows ONLY

S1 balances derive **solely from AR rows**. Payments migrate as independent records (T19) and **never enter the parity formula**.

Why this is forced, not chosen: payments and balances genuinely disagree inside S1 —

- **386 Cleared payments ($3.68M net) have zero ledger rows** (ruling item 2, §3).
- **6 more Cleared payments have allocation mismatches** (ruling item 3, §3).

Any formula mixing payments into the baseline would "fail" on S1's own internal inconsistency rather than on migration errors. The parity test measures whether S2 reproduces **S1's ledger**, exactly as it stands at freeze.

### 1.2 Grain

Primary diff grain: **(ledger_participant, ledger_account)**.

- Only **689 groups** across **263,656 rows** and **3 ledger accounts** — small enough to eyeball the full diff.
- `ledger_participant` is a **coarse (employer/group-level) entity**, not a worker.
- Per-worker drill-down rides on **`ledger_key`**: numeric on ~98.7% of rows, very likely nids. **Referent check still pending** — one query (N6-8) joins sample keys to `node.nid` and inspects the bundle. Run it before freeze so discrepancy drill-downs name the right entity type.

### 1.3 Formula

Per (participant, account) group:

```
S2 computed balance == SUM(ledger_amount) of that group's migrated AR rows
```

**to the cent, at the freeze snapshot.**

This is the **single governing acceptance rule**. It supersedes the earlier T19 contract (`sum(S1 ar) + sum(payments)` vs S2 balance) — the local `03-transformations.md` T19 entry has been amended to defer to this doc.

**No pinned dollar target** — parity is *measured, not asserted* (local 06 §4.18): S1 is under active remediation and the numbers move (canceled payments 122 → 114 since profiling; AR rows 261,808 → 263,656). The test asserts equality against whatever S1 holds at the freeze instant, never against a memorized figure.

### 1.4 Snapshot protocol — content fingerprint bracketing export AND ETL read

The writer freeze (payment entry is on the freeze-window writer list, local 06 §4.17) is the primary guarantee; this protocol is the empirical proof the halt held. Aggregate totals alone (COUNT/MAX/SUM) are **not** sufficient proof — compensating inserts/deletes or offsetting updates can preserve all three while changing per-group balances. Therefore the protocol uses a **deterministic row-content fingerprint** plus a repeat of the parity-grain export itself:

1. **N6-1 → fingerprint A**: COUNT, MAX(`ledger_id`), SUM(`ledger_amount`) **and** a row-content checksum (`BIT_XOR(CRC32(...))` over every column that enters parity — see the query). The checksum is a **best-effort mutation tripwire** (CRC32-XOR is order-insensitive and collision-prone, not cryptographic); the strong equality check is the ordered export comparison below.
2. **N6-2 → baseline export #1.**
3. **ETL read** of `sirius_ledger_ar`.
4. **N6-1 → fingerprint B** and **N6-2 → export #2.**

Acceptance requires **all** of:

- **A == B exactly**, including the content checksum — any per-row change flips it even when COUNT/SUM are preserved.
- **Export #1 is byte-identical to export #2** (the ordered export IS the parity-grain content fingerprint — 689 rows, trivially diffable; this ordered comparison, not the CRC checksum, is the strong check).
- **The ETL-owned export (below) is byte-identical to exports #1/#2** — the direct evidence the ETL ingested the same state the baseline describes.
- **The export reconciles to the fingerprint**: `SUM(n_rows)` over groups == fingerprint row count, `SUM(balance)` == fingerprint total.

On any mismatch: discard the exports and the ETL read and repeat from step 1.

**Execution mode — each check on a fresh snapshot.** Every N6-1/N6-2 run above executes as its own statement/transaction (autocommit), i.e. each observes a *fresh* snapshot. Do **NOT** wrap the bracketing queries in a single `START TRANSACTION WITH CONSISTENT SNAPSHOT` session: a pinned repeatable-read snapshot would make A/B and the two exports trivially identical even while writers mutate the table under the ETL's separate connection — it would verify nothing about what the ETL saw. (The only valid single-snapshot variant is one where the **ETL read itself** shares the same transaction/session as the fingerprints and export; if the ETL tooling supports that, the bracketing checks become redundant rather than wrong.)

**ETL-owned evidence.** The bracketing above shows the table was stable across the window; to tie the ETL's own read to that state, the ETL must additionally emit its own per-group export — same columns and ordering as N6-2, computed **from the rows it actually ingested** — as part of its run report. Acceptance requires this ETL-owned export to be byte-identical to the N6-2 exports. This, not the checksum, is the primary proof that the migrated rows and the parity baseline are the same data.

Dry-run fingerprint (2026-02): **263,656 rows / max ledger_id 551,071 / $11,862,152.13** — and the N6-2 group export (689 groups) reconciled to it exactly. (The content-checksum column was added after the dry run; capture its baseline at the pre-freeze rehearsal.)

### 1.5 Reporting

- Every discrepancy is reported **per group**, with `ledger_key`-level drill-down of the group's rows.
- Discrepancies are **never reconciled in flight**. The ETL must not silently normalize, round, drop, or "fix" anything — report and stop.

---

## 2. Edge dispositions (decided — no ruling needed)

| Edge | Disposition |
|---|---|
| **54 zero-amount AR rows** (52 with numeric `ledger_key`, 2 null — dry-run listing archived) | Import as-is. Zero balance impact; log the `ledger_id`s in the run report |
| **104 of 689 groups carry negative (credit) balances** | Legitimate overpayments. List in the parity report; do **not** "fix" |
| **Non-Cleared payments** — Failed 11 / Canceled 114 / Pending 105 / Received 12 | Migrate with normalized sign (T19 `abs()`), **no balance effect** (statuses other than Cleared never wrote ledger rows, local 06 §4.18). ⚠ **Sign inconsistency stated explicitly:** "Received" payment amounts are **POSITIVE** (+$226,942.26 total) while every other status is negative — an S1-internal inconsistency. T19's `abs()` normalization handles it, but any operator eyeballing raw sums must expect it |
| **One payment pointing at a nonexistent ledger account** (account nid in the local evidence appendix) — not one of the 3 ledger accounts | Dangling account reference. **T19 needs an unresolved-account disposition** (suggested: `s1-unknown` account handling, parallel to T18's `reference_type='s1-unknown'` rule). Loader change is out of this doc's scope; recorded here so T19 picks it up |

---

## 3. Ruling sheet — three items for Laura/Sam

Recommendations are stated per item; the migration proceeds under them unless the fund rules otherwise. **Sign-off on this sheet closes N6.**

### Item 1 — 8 canceled-with-ledger payments (~$384k)

Payments in status Canceled that nonetheless have ledger rows (cleared-then-canceled without reversal — local 06 §4.18 flagged them as a live data-integrity item). **Unchanged since profiling despite active remediation.** The 8 payment nids are listed in the local evidence appendix (untracked `docs/s1-migration/08-n6-balance-parity.md`).

**Recommend:** treat as a fund remediation item. If still unresolved at freeze: import the ledger rows as historical fact (they ARE the balance), flag the 8 payments in the parity report.

### Item 2 — 386 Cleared payments with zero ledger rows ($3.68M net)

- Confined to the same two AR accounts; mixed signs.
- Concentrated in 2025–2026 and **growing**: 2026 alone has 68 positive payments, +$5.07M, all on one of the two accounts.
- Pattern reads as a **live cleared-but-not-yet-allocated backlog**, not a separate workflow.

**Recommend:** expect the set to shrink by freeze as allocation catches up. Whatever remains migrates **as-is** (`allocated=true`, no balance effect, per T19) and is listed in the parity report.

### Item 3 — 6 Cleared allocation mismatches (payment amount ≠ allocated total)

Profile of the six (per-payment nids and exact amounts in the local evidence appendix):

- **One large under-application** (~$156k of a ~$158k payment left unapplied) — the headline case.
- **One sign-entry error** — a positive payment matched by an equal-magnitude negative allocation.
- **Four small residuals** (≤ ~$1k each, one of exactly $1).

**Recommend:** hand-review by the fund; **migrate as-is regardless** (ledger rows are the balance baseline either way).

---

## 4. Freeze-day query pack — N6-1..N6-8 (corrected)

MySQL dialect, `drush sqlq`, **aggregates only** (the prod query pack's HIPAA rule applies; ledger_participant/account/key ids and payment nids are entity ids, not PII).

> ⚠ **Sign-convention correction:** N6-5 as originally drafted computed `payment + alloc`, assuming positive payment amounts. **S1 payment amounts are negative, like their allocations** — the corrected mismatch formula is **`payment − alloc`** (both negative → mismatch 0 when they agree). The set below is the corrected version verified in the 2026-02 dry run; do not run the earlier draft.

```sql
-- N6-1: snapshot fingerprint — run as step 1 (A) and step 4 (B) of §1.4; A must equal B,
-- INCLUDING content_hash (a deterministic per-row checksum over every parity-relevant
-- column — flips on any update, even count/sum-preserving ones)
SELECT COUNT(*) AS n_rows, MAX(ledger_id) AS max_ledger_id, SUM(ledger_amount) AS total,
       BIT_XOR(CRC32(CONCAT_WS('|', ledger_id, ledger_participant, ledger_account,
                               COALESCE(ledger_key,''), ledger_amount))) AS content_hash
FROM sirius_ledger_ar;
-- dry-run (pre-checksum): 263,656 / 551,071 / 11,862,152.13

-- N6-2: the parity baseline — per-group export (689 groups; this is what S2 must reproduce).
-- Run INSIDE the fingerprint window (§1.4 step 2); its SUM(n_rows)/SUM(balance) must
-- reconcile exactly to the N6-1 fingerprint.
SELECT ledger_participant, ledger_account, COUNT(*) AS n_rows,
       SUM(CASE WHEN ledger_amount > 0 THEN ledger_amount ELSE 0 END) AS charges,
       SUM(CASE WHEN ledger_amount < 0 THEN ledger_amount ELSE 0 END) AS credits,
       SUM(ledger_amount) AS balance
FROM sirius_ledger_ar
GROUP BY ledger_participant, ledger_account
ORDER BY ledger_participant, ledger_account;

-- N6-3: zero-amount rows (import as-is; log ids) — dry-run: 54 rows, 52 numeric keys
SELECT ledger_id, ledger_participant, ledger_account, ledger_key
FROM sirius_ledger_ar WHERE ledger_amount = 0 ORDER BY ledger_id;

-- N6-4: negative-balance (credit) groups — list in report, do not fix — dry-run: 104 of 689
SELECT COUNT(*) AS credit_groups FROM (
  SELECT ledger_participant, ledger_account
  FROM sirius_ledger_ar
  GROUP BY ledger_participant, ledger_account
  HAVING SUM(ledger_amount) < 0
) g;

-- N6-5 (CORRECTED: payment − alloc, both sides negative): per-payment allocation reconcile
SELECT p.entity_id AS payment_nid,
       s.field_sirius_payment_status_value AS status,
       p.field_sirius_dollar_amt_value AS payment_amount,
       COALESCE(a.alloc_total, 0) AS ledger_alloc_total,
       COALESCE(a.n_rows, 0) AS n_ledger_rows,
       p.field_sirius_dollar_amt_value - COALESCE(a.alloc_total, 0) AS delta
FROM field_data_field_sirius_dollar_amt p
JOIN field_data_field_sirius_payment_status s
  ON s.entity_id = p.entity_id AND s.entity_type = 'node' AND s.bundle = 'sirius_payment'
 AND s.deleted = 0 AND s.language = 'und'
LEFT JOIN (
  SELECT ledger_reference, SUM(ledger_amount) AS alloc_total, COUNT(*) AS n_rows
  FROM sirius_ledger_ar WHERE ledger_amount < 0
  GROUP BY ledger_reference
) a ON a.ledger_reference = p.entity_id
WHERE p.entity_type = 'node' AND p.bundle = 'sirius_payment'
  AND p.deleted = 0 AND p.language = 'und'
ORDER BY p.entity_id;
-- Parity-relevant subsets: status='Cleared' AND n_ledger_rows=0 (ruling item 2);
-- status='Cleared' AND delta <> 0 (ruling item 3); status='Canceled' AND n_ledger_rows>0 (item 1).

-- N6-6: payment status × amount recap (expect the Received-rows-POSITIVE sign quirk, §2)
SELECT s.field_sirius_payment_status_value AS status, COUNT(*) AS n,
       SUM(d.field_sirius_dollar_amt_value) AS total
FROM field_data_field_sirius_payment_status s
JOIN field_data_field_sirius_dollar_amt d
  ON d.entity_id = s.entity_id AND d.entity_type = 'node' AND d.bundle = 'sirius_payment'
 AND d.deleted = 0 AND d.language = 'und'
WHERE s.entity_type = 'node' AND s.bundle = 'sirius_payment'
  AND s.deleted = 0 AND s.language = 'und'
GROUP BY status;
-- dry-run counts: Cleared (rest), Failed 11, Canceled 114, Pending 105, Received 12 (+226,942.26)

-- N6-7: dangling payment→account references (dry-run found one — nid in local appendix)
SELECT la.field_sirius_ledger_account_target_id AS account_nid, COUNT(*) AS payments
FROM field_data_field_sirius_ledger_account la
WHERE la.entity_type = 'node' AND la.bundle = 'sirius_payment'
  AND la.deleted = 0 AND la.language = 'und'
  AND la.field_sirius_ledger_account_target_id NOT IN
      (SELECT nid FROM node WHERE type = 'sirius_ledger_account')
GROUP BY account_nid;

-- N6-8: ledger_key referent check (STILL PENDING — run before freeze): what bundle do the keys point at?
SELECT n.type AS bundle, COUNT(*) AS keys_resolving
FROM (SELECT DISTINCT ledger_key FROM sirius_ledger_ar
      WHERE ledger_key REGEXP '^[0-9]+$' LIMIT 5000) k
LEFT JOIN node n ON n.nid = CAST(k.ledger_key AS UNSIGNED)
GROUP BY n.type ORDER BY keys_resolving DESC;
```

### Freeze-day run order

1. **N6-1** (fingerprint A, incl. content_hash).
2. **N6-2** export #1 — the parity baseline file.
3. ETL reads `sirius_ledger_ar`.
4. **N6-1** again (fingerprint B) and **N6-2** export #2 — B must equal A (incl. content_hash), export #2 must be byte-identical to export #1, the ETL's own per-group export (from the rows it ingested) must be byte-identical to both, and the export must reconcile to the fingerprint's `SUM(n_rows)` / `SUM(balance)`; on any mismatch discard everything and repeat from step 1. Each check runs on its own fresh snapshot — never inside one pinned read transaction (§1.4).
5. N6-3/N6-4 → edge listings for the report; N6-5/N6-6/N6-7 → payment-side report sections (no balance effect); N6-8 should already have been run pre-freeze.
6. After T18 load: compute S2 per-group balances, diff against the N6-2 export **to the cent**, report per §1.5.

---

## 5. Out of scope here

- The S2-side comparator script (separate task — consumes the N6-2 export).
- T18/T19 loader changes (the §2 unresolved-account item is recorded for T19, not implemented here).
- Closing N6 in local 06 §8 — happens only after Laura/Sam sign off on §3.
