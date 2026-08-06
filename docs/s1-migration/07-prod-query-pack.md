# Production Query Pack (drush, aggregates only)

Run each via `drush sqlq "<SQL>"` against production. **HIPAA rule: aggregates only — never row-level PII.** The only value-level outputs below are non-PII config data: taxonomy term names, provider/company org names, `variable` **names** (never values), flag names, webservice definition titles. If any query surprises you with person-level data, stop and report the shape, not the values.

Each item says which open question it closes and what the result decides. Paste raw outputs back; I'll fold them into the spec.

---

> **⚠️ PACK LARGELY SUPERSEDED (2026-08-04).** [06-strategy-revision.md](06-strategy-revision.md) **v5** folded a full production profiling pass; the questions behind §B, §C (was already optional), §D, §E, §F, §G, §H, §I, §J, §L, and the Q10/Q29 parts of §M are **closed** — do not run them. Still live: **§N** (N3/N4 — one aggregate each + S1 knowledge), §K only for **Q31** (json-definition endpoint titles / live consumers), and the **Q11/Q12** parts of §M (contact tags / websites). The authoritative open list is 06 v5 §8.

## A. N11 — worker-month tag vocabulary (blocks T29, 2.53M rows) — ✅ RUN + CLOSED (v5 §4.2)

```sql
-- A1: which vocabulary the tags come from
SELECT v.machine_name, v.name, COUNT(DISTINCT t.tid) AS distinct_terms, COUNT(*) AS uses
FROM field_data_field_sirius_contact_tags f
JOIN taxonomy_term_data t ON t.tid = f.field_sirius_contact_tags_tid
JOIN taxonomy_vocabulary v ON v.vid = t.vid
WHERE f.bundle = 'smf_worker_month'
GROUP BY v.vid;

-- A2: full term frequency (term names are the vocabulary N11 asks for)
SELECT t.tid, t.name, COUNT(*) AS uses
FROM field_data_field_sirius_contact_tags f
JOIN taxonomy_term_data t ON t.tid = f.field_sirius_contact_tags_tid
WHERE f.bundle = 'smf_worker_month'
GROUP BY t.tid ORDER BY uses DESC;

-- A3: tags-per-row distribution
SELECT delta, COUNT(*) FROM field_data_field_sirius_contact_tags
WHERE bundle = 'smf_worker_month' GROUP BY delta ORDER BY delta;
```

**Decides:** the tag vocabulary itself. The S2-home decision (new table vs existing structure) follows from what the terms turn out to be — if they're employment/eligibility classifications, they may map onto existing S2 concepts and N11 stops needing Sam/Kristin at all.

> **RUN 2026-08-04 — ANSWERED.** A1: one vocabulary, `sirius_contact_tags`, 59 distinct terms, 13,548,519 uses. A2: 60 terms observed, five families (Hours:/Election Type:/Benefit:/Plan:/Status:), all derived autotag output — full frequency table archived in the repl attachment and summarized in 05 N11. A3: delta 0 = 2,485,943 rows (≈ full spine tagged), tapering to delta 17 = 5 rows. Result recorded in **05-open-questions.md N11**; recommendation = stage-only, no new S2 table.

## B. N12 — member_status: does any worker hold two terms in the SAME industry?

S2 target already exists and fits: `options_worker_ms` (has `sirius_id`, `industry_id`, `sequence`) + `worker_msh` (current status = latest row **per industry**). The ONLY thing that can break the mapping is a worker with two concurrent terms in one industry.

```sql
-- B1: co-assignment matrix (term names only)
SELECT ta.name AS delta0_term, tb.name AS other_term, COUNT(*) AS workers
FROM field_data_field_sirius_member_status a
JOIN field_data_field_sirius_member_status b
  ON b.entity_id = a.entity_id AND b.entity_type='node' AND b.bundle='sirius_worker' AND b.delta > 0
JOIN taxonomy_term_data ta ON ta.tid = a.field_sirius_member_status_tid
JOIN taxonomy_term_data tb ON tb.tid = b.field_sirius_member_status_tid
WHERE a.entity_type='node' AND a.bundle='sirius_worker' AND a.delta = 0
GROUP BY ta.tid, tb.tid ORDER BY workers DESC;

-- B2: full member-status term list (ordered)
SELECT t.tid, t.name, t.weight FROM taxonomy_term_data t
JOIN taxonomy_vocabulary v ON v.vid = t.vid
WHERE v.machine_name = 'sirius_member_status' ORDER BY t.weight, t.name;
```

**Decides:** if every co-assignment pair crosses industries → N12 closes without Sam (map term→`options_worker_ms` by `sirius_id`, one `worker_msh` row per industry, delta order becomes irrelevant). Same-industry pairs → that conflict list is the one question for Sam.

## C. N14 — AAT / Union ID / External ID format profile

```sql
-- C1 (repeat for id2 and id3 by swapping table+column):
SELECT CHAR_LENGTH(field_sirius_aat_value) AS len,
       SUM(field_sirius_aat_value REGEXP '^[0-9]+$') AS all_digits, COUNT(*) AS n
FROM field_data_field_sirius_aat WHERE bundle='sirius_worker'
GROUP BY len ORDER BY len;
```

> **§C is now OPTIONAL** — N14 closed (mmcdermott4: ignore AAT/Titan provenance; both migrate as opaque strings, no validator). Run only if we later want format validators on `options_worker_id_type`.

## D. N15 — active writers (the freeze list), empirically

```sql
SELECT type, COUNT(*) AS created_14d FROM node
WHERE created > UNIX_TIMESTAMP(NOW() - INTERVAL 14 DAY)
GROUP BY type ORDER BY created_14d DESC;

SELECT type, COUNT(*) AS changed_14d FROM node
WHERE changed > UNIX_TIMESTAMP(NOW() - INTERVAL 14 DAY)
GROUP BY type ORDER BY changed_14d DESC;
```

**Decides:** the complete freeze-window writer list (expected: `sirius_payperiod` imports, `smf_worker_month` via wym.inc, `sirius_trust_worker_benefit` via scanner, logs). Anything unexpected in this list is a writer we didn't know about.

## E. N16 — is the Oct-2023 `node.changed` cliff real?

```sql
SELECT FROM_UNIXTIME(changed,'%Y-%m') AS ym, COUNT(*) FROM node GROUP BY ym ORDER BY ym;

SELECT type, FROM_UNIXTIME(MIN(created)) AS first_created, FROM_UNIXTIME(MAX(created)) AS last_created
FROM node GROUP BY type ORDER BY type;
```

**Decides:** whether `changed` is trustworthy (real Oct-2023 system event → it's meaningful) or an artifact.

## F. N18 — identify the 10 legacy-format payperiod rows

```sql
SELECT entity_id AS nid FROM field_data_field_sirius_json
WHERE bundle='sirius_payperiod'
  AND JSON_TYPE(JSON_EXTRACT(field_sirius_json_value, '$.entries')) = 'ARRAY';

-- then for those nids (no worker join needed):
SELECT n.nid, FROM_UNIXTIME(n.created) AS created, ds.field_sirius_date_start_value AS period_start
FROM node n LEFT JOIN field_data_field_sirius_date_start ds ON ds.entity_id = n.nid
WHERE n.nid IN (/* paste nids */);
```

**Decides:** individual dispositions (likely all ancient test/import artifacts → documented skip).

## G. N6 / Q19 / Q20 — ledger + payment reconciliation inputs

```sql
-- G1: ledger status + sign conventions
SELECT ledger_status, COUNT(*) AS n, SUM(ledger_amount) AS total FROM sirius_ledger_ar GROUP BY ledger_status;
SELECT SIGN(ledger_amount) AS sgn, COUNT(*) AS n, SUM(ledger_amount) AS total FROM sirius_ledger_ar GROUP BY sgn;

-- G2: ledger_key shape (is it a structured id?)
SELECT SUM(ledger_key REGEXP '^[0-9]+$') AS numeric_keys, SUM(ledger_key = '' OR ledger_key IS NULL) AS empty_keys, COUNT(*) AS total FROM sirius_ledger_ar;

-- G3: payment status x amount
SELECT fs.field_sirius_payment_status_value AS status, COUNT(*) AS n, SUM(fd.field_sirius_dollar_amt_value) AS total
FROM field_data_field_sirius_payment_status fs
JOIN field_data_field_sirius_dollar_amt fd ON fd.entity_id = fs.entity_id
WHERE fs.bundle='sirius_payment' GROUP BY status;

-- G4: allocated flag distribution
SELECT field_sirius_ledger_allocated_value, COUNT(*) FROM field_data_field_sirius_ledger_allocated GROUP BY 1;
```

**Decides:** Q19 (non-Cleared statuses needing a policy), payment sign conventions, and the shape of the N6 balance-parity acceptance test.

## H. Q36 — SSN quality (formats/duplicates only — NEVER select values)

```sql
SELECT CHAR_LENGTH(field_sirius_ssn_value) AS len, COUNT(*) FROM field_data_field_sirius_ssn
WHERE bundle='sirius_worker' GROUP BY len ORDER BY len;

SELECT SUM(field_sirius_ssn_value REGEXP '^[0-9]{9}$') AS digits9,
       SUM(field_sirius_ssn_value REGEXP '^[0-9]{3}-[0-9]{2}-[0-9]{4}$') AS dashed,
       COUNT(*) AS total
FROM field_data_field_sirius_ssn WHERE bundle='sirius_worker';

SELECT dup_size, COUNT(*) AS dup_groups FROM (
  SELECT COUNT(*) AS dup_size FROM field_data_field_sirius_ssn
  WHERE bundle='sirius_worker' GROUP BY field_sirius_ssn_value HAVING COUNT(*) > 1
) x GROUP BY dup_size;
```

**Decides:** normalization rule + how big the duplicate-SSN review queue is.

## I. Q33 / Q39 — variable names + opt-out storage

```sql
-- I1: names ONLY — never SELECT value from this table
SELECT name FROM variable ORDER BY name;

-- I2: any opt-out-ish fields we missed
SELECT field_name FROM field_config
WHERE field_name LIKE '%opt%' OR field_name LIKE '%unsub%' OR field_name LIKE '%do_not%' OR field_name LIKE '%dnc%';

-- I3: sms/voice-possible distributions (the likely opt-out mechanism)
SELECT field_sirius_sms_possible_value, COUNT(*) FROM field_data_field_sirius_sms_possible GROUP BY 1;
SELECT field_sirius_voice_possible_value, COUNT(*) FROM field_data_field_sirius_voice_possible GROUP BY 1;
```

## J. Q34 — the single flag type (245 flaggings)

```sql
SELECT fid, name, title, entity_type FROM flag;
SELECT fid, entity_type, COUNT(*) FROM flagging GROUP BY fid, entity_type;
```

## K. N5 / N8 / Q31 — small-bundle eyeballs (org names / endpoint titles, non-PII)

```sql
SELECT nid, title FROM node WHERE type='sirius_trust_provider';                         -- 12 carriers
SELECT type, nid, title FROM node WHERE type IN ('grievance_company','grievance_chapter'); -- 5 org names
SELECT COUNT(*), SUM(title REGEXP '[0-9]{7,}') AS phoneish FROM node WHERE type='sirius_twilio_conversation'; -- shape only (titles may hold numbers)
SELECT nid, title FROM node WHERE type='sirius_json_definition' ORDER BY title;         -- 144 webservice defs (Q31: which have live consumers?)
```

## L. N10 — worker-attached vs contact-attached contact fields (email as proxy)

```sql
SELECT SUM(we.entity_id IS NOT NULL AND ce.entity_id IS NOT NULL) AS both_have,
       SUM(we.entity_id IS NOT NULL AND ce.entity_id IS NULL) AS worker_only,
       SUM(we.entity_id IS NULL AND ce.entity_id IS NOT NULL) AS contact_only,
       SUM(we.entity_id IS NOT NULL AND ce.entity_id IS NOT NULL
           AND LOWER(we.field_sirius_email_value) = LOWER(ce.field_sirius_email_value)) AS both_match,
       COUNT(*) AS workers
FROM node w
LEFT JOIN field_data_field_sirius_contact c ON c.entity_id = w.nid AND c.bundle='sirius_worker'
LEFT JOIN field_data_field_sirius_email we ON we.entity_id = w.nid AND we.bundle='sirius_worker'
LEFT JOIN field_data_field_sirius_email ce ON ce.entity_id = c.field_sirius_contact_target_id AND ce.bundle='sirius_contact'
WHERE w.type='sirius_worker';
```

**Decides:** precedence rule (if `both_have ≈ both_match`, worker copies are denorm mirrors → contact wins; big mismatch → real question).

## M. Q10 / Q11 / Q12 / Q29 — quick distributions

```sql
SELECT field_sirius_lang_value, COUNT(*) FROM field_data_field_sirius_lang GROUP BY 1;              -- Q10

SELECT t.name, COUNT(*) AS uses FROM field_data_field_sirius_contact_tags f                          -- Q11 (contacts, not worker-months)
JOIN taxonomy_term_data t ON t.tid=f.field_sirius_contact_tags_tid
WHERE f.bundle='sirius_contact' GROUP BY t.tid ORDER BY uses DESC LIMIT 40;

SELECT SUM(field_sirius_id_value REGEXP '^[+0-9() .-]{7,20}$') AS phone_shaped, COUNT(*) AS total    -- Q12
FROM field_data_field_sirius_id WHERE bundle='sirius_phonenumber';
SELECT SUM(title REGEXP '^[+0-9() .-]{7,20}$') AS phone_shaped_titles, COUNT(*) FROM node WHERE type='sirius_phonenumber';

SELECT field_sirius_type_value, COUNT(*) FROM field_data_field_sirius_type                           -- Q29
WHERE bundle='sirius_log' GROUP BY 1 ORDER BY 2 DESC;
```

## P. Loader verification queries (added 2026-08-04 after T20 build)

### P1 — OPEN-3: do negative hours totals exist in prod?

```sql
-- Legacy-format rows (entries as array) yield NULL from the JSON path and drop out — correct.
SELECT COUNT(*) AS negative_rows
FROM field_data_field_sirius_json j
WHERE j.bundle='sirius_payperiod' AND j.deleted=0
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(j.field_sirius_json_value,'$.totals.hours.total')) AS DECIMAL(14,2)) < 0;
```

**RUN 2026-08-04: 381 negative rows exist** — OPEN-3 stays open for Kristin. Profile them:

### P1b — OPEN-3 evidence: negative-hours distribution for Kristin

```sql
-- Distribution by year and magnitude (no PII — counts and hour values only)
SELECT YEAR(s.field_sirius_date_start_value) AS yr,
       COUNT(*) AS n, MIN(t.v) AS worst, MAX(t.v) AS mildest, SUM(t.v) AS total_neg_hours
FROM (SELECT j.entity_id,
             CAST(JSON_UNQUOTE(JSON_EXTRACT(j.field_sirius_json_value,'$.totals.hours.total')) AS DECIMAL(14,2)) AS v
        FROM field_data_field_sirius_json j
       WHERE j.bundle='sirius_payperiod' AND j.deleted=0) t
JOIN field_data_field_sirius_date_start s
  ON s.entity_id=t.entity_id AND s.bundle='sirius_payperiod' AND s.deleted=0
WHERE t.v < 0
GROUP BY yr ORDER BY yr;

-- 20 sample nids for UI eyeballing (are they paired with an offsetting positive period?)
SELECT j.entity_id AS nid,
       CAST(JSON_UNQUOTE(JSON_EXTRACT(j.field_sirius_json_value,'$.totals.hours.total')) AS DECIMAL(14,2)) AS hours
FROM field_data_field_sirius_json j
WHERE j.bundle='sirius_payperiod' AND j.deleted=0
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(j.field_sirius_json_value,'$.totals.hours.total')) AS DECIMAL(14,2)) < 0
ORDER BY hours ASC LIMIT 20;
```

Key question for Kristin: are these deliberate correction/backout entries (→ load as-is, so monthly sums stay accurate — T20's current behavior) or data errors (→ skip or zero, with reporting)? Note T20 SUMS payperiods per month, so a negative paired with a positive in the same month nets correctly under load-as-is.

### P2 — OPEN-5: do boundary-spanning payperiods exist in prod?

```sql
SELECT COUNT(*) AS boundary_spanning
FROM field_data_field_sirius_date_start s
JOIN field_data_field_sirius_date_end e
  ON e.entity_id=s.entity_id AND e.bundle='sirius_payperiod' AND e.deleted=0
WHERE s.bundle='sirius_payperiod' AND s.deleted=0
  AND DATE_FORMAT(s.field_sirius_date_start_value,'%Y-%m') <> DATE_FORMAT(e.field_sirius_date_end_value,'%Y-%m');
```

Expected (per Sam): 0. Same disposition pattern as P1 (`boundarySpanningPeriods_OPEN5` counter is the production tripwire).

### P3 — N19 input: the full carrier-name universe for the fund to annotate

Two lists the alias table must cover (06 §4.15 — tags reference carriers absent from the provider list and vice versa):

```sql
SELECT nid, title FROM node WHERE type='sirius_trust_provider' ORDER BY title;            -- 12 provider nodes
SELECT tid, name FROM taxonomy_term_data WHERE name LIKE 'Benefit:%' ORDER BY name;       -- Benefit: tags
```

Paste both lists back; I'll draft the alias→canonical table pre-filled with the four confirmed identity groups (UHDC, MLK, Express Scripts, Carelon) for the fund to correct and sign off.

## N. N3 / N4 — one aggregate each + your S1 knowledge

```sql
SELECT FROM_UNIXTIME(MIN(created)) AS first_, FROM_UNIXTIME(MAX(created)) AS last_, COUNT(*) FROM node WHERE type='sirius_employer_payperiod';
SELECT FROM_UNIXTIME(MIN(created)) AS first_, FROM_UNIXTIME(MAX(created)) AS last_, COUNT(*) FROM node WHERE type='sirius_employee';
```

From your knowledge:
- **N3:** `sirius_employer_payperiod` profiles as a pure period header — employer ref + date_start/end + datetime/datetime_completed + active, **no amounts, no JSON**. Is it the employer remittance/reporting period tracker in the UI? If yes → maps to `wizard_employer_monthly` (or drops, since S2 recreates wizard state per import).
- **N4:** `sirius_employee` profiles as worker ref + shop ref + `field_sirius_id` + domain (539 rows). What UI feature uses it? It looks like a worker↔employer employment link with an external employee code.

### P4 — policy target bundle (blocks load-policies; added 2026-08-04 after milestone-3 build)

`field_sirius_trust_policy` has 223,909 rows in production, but its target
bundle appears nowhere in the 04 bundle census, and the synthetic DB's copy of
the field table is empty — the loader could not be pointed at a source.
`load-policies.ts` is adopt-only (S2 `policies` rows are configuration) and
hard-fails on unresolvable refs, so this must be answered before the prod run:

```sql
SELECT n.type AS target_bundle, COUNT(*) AS refs, COUNT(DISTINCT n.nid) AS distinct_targets
  FROM field_data_field_sirius_trust_policy f
  JOIN node n ON n.nid = f.field_sirius_trust_policy_target_id
 WHERE f.entity_type = 'node' AND f.deleted = 0
 GROUP BY n.type;

-- Distinct target titles (org-level plan names, non-PII — expected to match
-- the configured S2 policies: Participation Agreement / Restaurant /
-- Event Center / COBRA or their codes):
SELECT DISTINCT n.nid, n.type, n.title
  FROM field_data_field_sirius_trust_policy f
  JOIN node n ON n.nid = f.field_sirius_trust_policy_target_id;

-- Also confirm whether any target is NOT a node (0 expected — entityreference
-- to taxonomy terms would join term ids instead):
SELECT COUNT(*) AS refs_without_node
  FROM field_data_field_sirius_trust_policy f
  LEFT JOIN node n ON n.nid = f.field_sirius_trust_policy_target_id
 WHERE f.entity_type = 'node' AND f.deleted = 0 AND n.nid IS NULL;
```

If the answering bundle is not in `stage.ts`'s in-scope list, add it and
re-stage before `load-policies.ts`.

### P5 — T24 shop-contact type cardinality (RUN 2026-08-05) — ✅ RULED (N25 CLOSED: multi-link shipped)

**Measured:** 557 shop contacts — **4 no-type, 202 single-type, 351 multi-type (63%)**;
**363 type assignments were lost under the old single-link storage rule.** 356 of the
351 multi-type contacts carry exactly 1 `co_role` + 1 taxonomy term; only 12 have ≥2
taxonomy terms.

**Ruling (2026-08-05):** widen `employer_contacts` to **MULTI-LINK** — one row per
(contact, employer, type). Shipped same day: storage uniqueness moved from the
(contact, employer) pair to the triple; the T24 loader creates one link per resolved
type (co_role first, then term order), heals prior single-link rows (an untyped link
is retyped to the first missing type), keeps operator-added links (`s2ExtraLinksKept`).
**Prod expectation: ~920 links (557 + 363), 0 assignments lost; `extra_contact_types_dropped` no longer exists as a reject class.**

Representative re-run query (aggregates only):

```sql
SELECT COUNT(*) AS contacts,
  SUM((role_n + term_n) = 0)  AS no_type,
  SUM((role_n + term_n) = 1)  AS single_type,
  SUM((role_n + term_n) > 1)  AS multi_type,
  SUM(GREATEST(role_n + term_n - 1, 0)) AS assignments_lost_under_single_link
FROM (
  SELECT n.nid,
    (SELECT COUNT(*) FROM field_data_field_grievance_co_role r
      WHERE r.entity_id=n.nid AND r.deleted=0
        AND r.field_grievance_co_role_value IS NOT NULL AND r.field_grievance_co_role_value<>'') AS role_n,
    (SELECT COUNT(*) FROM field_data_field_grievance_contact_types t
      WHERE t.entity_id=n.nid AND t.deleted=0) AS term_n
  FROM node n WHERE n.type='grievance_shop_contact'
) x;
```

### P6 — T15 relationship date quality (RUN 2026-08-05) — ✅ RULED (N26 CLOSED: defaults shipped)

**Measured (35,793 rows — grew from 35,774 on 08-04):** **115 missing start**,
**2 future start** (the same 2 are the inactive-without-end rows whose
`changed`/`created` fallbacks precede start), **0 end-before-start**; 132 rows carry
an end date. Reject envelope was ≤117 rows (~0.33%).

**Ruling (2026-08-05):** the 115 missing-start rows **DEFAULT-DATE** — start
`2000-01-01`, end `2000-01-02` unless a real S1 end date exists (kept);
`data.datesDefaulted=true` marks them in S2. The 2 future-start rows were **fixed
directly in S1 by the fund** — a re-run of the query below should now show
`future_start = 0`; `future_start_date` stays a FATAL loader tripwire, as do
`bad_start_date` (present-but-unparseable), `bad_end_date`, `end_before_start`.

Re-run to confirm the S1 fix before the prod load:

```sql
SELECT COUNT(*) AS total,
  SUM(s.field_sirius_date_start_value IS NULL) AS missing_start,
  SUM(s.field_sirius_date_start_value > NOW()) AS future_start,
  SUM(e.field_sirius_date_end_value IS NOT NULL AND s.field_sirius_date_start_value IS NOT NULL
      AND e.field_sirius_date_end_value < s.field_sirius_date_start_value) AS end_before_start
FROM node n
LEFT JOIN field_data_field_sirius_date_start s ON s.entity_id=n.nid AND s.deleted=0
LEFT JOIN field_data_field_sirius_date_end   e ON e.entity_id=n.nid AND e.deleted=0
WHERE n.type='sirius_contact_relationship';
```
