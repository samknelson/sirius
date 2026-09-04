# Strategy Revision — S1 Source Is MariaDB, Not Postgres

**Version 5 — 2026-08-04.** Supersedes all prior versions. If you have v2 or v4, delete them — do not merge.

**Two reclassifications since v4:**
1. `smf_worker_month` moves from "migrate" to **EXTRACT-AND-STAGE** (§4.2) — the tags turned out to be S1's computed eligibility state, not source data.
2. `node.changed` is **rehabilitated** as a usable business timestamp (§4.14) — the "anonymization artifact" caveat was wrong.

Other v5 changes, all from live production profiling: N12 closed (member-status co-assignments always cross industries — delta order is NOT meaningful, reversing v4); Q10/Q19/Q29/Q33/Q34/Q36/Q39 closed; carrier consolidation table added (§4.15); secrets inventory and rotation plan (§4.16); freeze-window writer list (§4.17); ledger/payment reconciliation facts (§4.18); legacy payperiod rows identified (§4.12).

**Status:** supersedes assumptions in `README.md`, `01-field-inventory.md`, and all SQL in `04-entity-reassembly.md`.

> **v5.1 amendments — 2026-08-05 (fund rulings + prod measurements, applied in place):**
> 1. **OPEN-3 CLOSED** — negative hours import as-is (BPA-era corrections; kept for pension vesting; no charges generate from negative hours).
> 2. **N17 CLOSED** — benefit history **imports directly** (§4.13): no policy history in S1 → regeneration not viable; ALL raw records — NO cutoff (amended 2026-08-05: import everything); S1 stays system of record through transition. Validation replaced by the **month-parity run** (§9 item 10).
> 3. **Carelon/VSP consolidation CLOSED** — no transform at migration, carry over as-is (§4.15); splitting deferred to a later S2 phase; N19 alias table becomes later-phase input.
> 4. **N11 amended → N24, then N24 CLOSED same day** — keep-list ruled: exactly ONE tag migrates, **"Comms: Received Enrollment Packet"**; every other worker-month tag stays extract-and-stage (§4.2).
> 5. **N25 + N26 raised and CLOSED same day (2026-08-05):** N25 — `employer_contacts` widened to MULTI-LINK, one row per (contact, employer, type); storage + T24 loader shipped. N26 — the 115 missing-start relationship rows load with default dates (start `2000-01-01`, end `2000-01-02` unless a real S1 end exists); the 2 future-start rows were fixed directly in S1 (loader tripwire expects 0). Details 07 §P5/§P6.

---

## 1. Context

The migration spec in this repo was built against a Neon Postgres database described as "the live S1 database (profiled directly over the read-only connection)."

That description is wrong, and the error is upstream of the spec.

**Production S1 is MariaDB 10.6.25**, running on AWS RDS (`smf-db-prod`, us-west-2). The database Replit profiled was produced by this path:

```
MariaDB (prod)
  → .txt JSON export, first ~10 rows per table
  → hand-loaded into Neon Postgres
  → given to Replit as "the S1 database"
```

Two consequences:

1. **Every type in `01-field-inventory.md` describes the Postgres landing type chosen by the JSON loader** — not S1's actual column definition. The inferences are artifacts of the transload.
2. **Every query in the spec is Postgres dialect** and will not execute against MariaDB: `to_timestamp(n.created::bigint)`, `array_agg(value ORDER BY delta::int)`, `::` casts, lateral subqueries, `pg_class.reltuples`.

Additionally, the export was **~10 rows per table across 431 tables**. Production has **818 tables**. Roughly half the schema was never visible.

---

## 2. What survives, what does not

| Artifact | Status |
|---|---|
| `02-mapping.md` — S1 field → S2 target logic | **Mostly survives.** Destination decisions are sound; grievance section needs rebuild (§4.3) |
| `04-entity-reassembly.md` — bundle → entity targets | **Survives.** All SQL in it must be rewritten for MySQL dialect |
| `04` — revision-history policy | **Survives.** Drop-by-default with three exceptions is still correct |
| README classification key (direct / NEEDS-TRANSFORM / etc.) | **Survives** |
| `01-field-inventory.md` — all inferred types | **Void.** Replace wholesale from `columns.tsv` |
| All SQL in every document | **Void.** Postgres dialect |
| `05-open-questions.md` Q0, Q25, Q32, timezone item | **Closed** — see §4, §5 |
| Bundle census ("~30+ reconstructed from evidence") | **Void.** Replaced by real census, §4.1 |

---

## 3. Artifacts

Extracted from a temporary restore of production (`smf-db-phi-schema-src`), since deleted. All four files are structure and aggregates only — **no production rows are included in any of them.**

| File | Contents | Rows |
|---|---|---|
| `s1-schema.sql` | `mariadb-dump --no-data` — full DDL, all 818 tables, verified 0 `INSERT` statements | 818 `CREATE TABLE` |
| `profile/tables.tsv` | Per table: engine, approx row count, data/index MB, collation | 818 |
| `profile/columns.tsv` | Per column: real MariaDB `data_type`, `column_type`, nullability, default, key, charset | ~6–8k |
| `profile/fielddata_stats.tsv` | Per `field_data_*` table × entity_type × bundle × language: max delta, row count. Filtered to `deleted=0` | one row per table/entity_type/bundle combination |

`fielddata_stats.tsv` is the highest-value file for reassembly work: it states definitively which fields are multi-value (`max_delta > 0`) and therefore require aggregation rather than a flat join.

---

## 4. Findings that change scope

### 4.1 Real bundle census (Q0 — CLOSED)

40 populated node bundles, 9.15M nodes total. 56 bundles are configured in `field_config_instance`; 16 have zero nodes.

| Bundle | Nodes | Note |
|---|---|---|
| `sirius_payperiod` | 3,617,328 | |
| `smf_worker_month` | 2,532,136 | **IN SCOPE — see §4.2.** Tags are the payload |
| `sirius_log` | 1,782,747 | |
| `sirius_trust_worker_benefit` | 609,486 | |
| `sirius_trust_worker_election` | 243,328 | |
| `sirius_contact` | 131,660 | |
| `sirius_worker` | 117,679 | |
| `sirius_dispatch` | 51,497 | **OUT OF SCOPE** — §4.7 |
| `sirius_contact_relationship` | 35,774 | |
| `sirius_employer_payperiod` | 18,395 | **Unmapped** |
| `sirius_phonenumber` | 3,952 | |
| `sirius_feed` | 3,684 | |
| `sirius_payment` | 3,458 | See §4.6 |
| `grievance_shop_contact` | 557 | |
| `sirius_employee` | 539 | **Unmapped** — distinct from `sirius_worker` |
| `sirius_dispatch_job` | 318 | **OUT OF SCOPE** — §4.7 |
| `sirius_term_proxy` | 254 | |
| `grievance_shop` | 254 | |
| `sirius_help` | 164 | |
| `sirius_json_definition` | 144 | |
| `sirius_bulk` | 45 | |
| `sirius_trust_benefit` | 19 | |
| `sirius_trust_provider` | 12 | **Unmapped** — carriers |
| `grievance_letter_template` | 9 | |
| `sirius_twilio_conversation` | 8 | **Unmapped** |
| `sirius_phonenubmer` | 7 | **Misspelled bundle in production** — see §6 |
| `grievance_basic_page` | 6 | |
| `grievance_field_overrides` | 6 | |
| `sirius_news` | 5 | |
| `page` | 3 | |
| `sirius_ledger_account` | 3 | |
| `grievance_company` | 3 | **Unmapped** |
| `grievance_holiday` | 2 | |
| `grievance_chapter` | 2 | **Unmapped** |
| `member` | 1 | Vestigial — **Q32 CLOSED**, drop |
| `sirius_letterhead` | 1 | |
| `sirius_dispatch_facility` | 1 | **OUT OF SCOPE** — §4.7 |
| `sirius_callerid` | 1 | |
| `grievance_contract_template` | 1 | |
| `sirius_domain` | 1 | |

**Configured but empty — do not build ETL for these:**
`grievance` (89 fields), `sirius_edls_sheet` (14), `grievance_log` (12), `grievance_contract_clause` (10), `grievance_settlement` (9), `grievance_contract_rule` (7), `sirius_office_timeoff_request` (7), `sirius_trust_service` (7), `sirius_event` (7), `sirius_dispatch_job_group` (6), `sirius_event_participant` (6), `grievance_contract_section` (5), `sirius_emailaddress` (4), `sirius_dispatch_facility_hall` (4), `grievance_attachment` (4), `sirius_operator` (4), `sirius_bu` (3), `grievance_contract` (3), `sirius_document_retention_log` (3), `grievance_irset` (2).

### 4.2 `smf_worker_month` — EXTRACT AND STAGE (reclassified in v5)

History of this item: v2 said DROP (wrong — assumed the JSON was the whole payload). v4 said migrate (wrong — assumed the tags were source data). **v5: the tags are S1's *computed* eligibility state, and the bundle is a denormalized cache.** It gets the same treatment as benefit history (§4.13): extract to staging, never load to S2 as live data.

2.53M nodes. The tag vocabulary (`sirius_contact_tags`, 59 terms, 13.5M tag rows, up to 18 tags per worker-month) is five families of derived conclusions:

| Family | Examples | Derived from |
|---|---|---|
| Hours | Nonzero 60 Months Previous, In Break 1–12 Months, In Buildup 1–4 Months, Buildup Complete, Incomplete Data | hours records |
| Benefit | Kaiser, Delta, VSP, Liberty, Express Scripts, MLK, Progyny, … | benefit grants |
| Election Type | Single, Single +1, Family, Waived, [No Election] | elections |
| Plan | Legacy, Hotel, Event Center, Participation Agreement, Inactive | eligibility group |
| Status | Disability, FMLA | hour types |

Every family restates something S2 will compute from migrated source data. Migrating the tags imports stale conclusions computed under old rules — the exact failure §4.13 exists to avoid. Discarding them destroys the only record of what S1 concluded per worker-month.

**Therefore: extract to staging.** Their value is as validation evidence — when S2's scan regenerates eligibility, diff its conclusions against these tags. 2.5M worker-months of recorded S1 decisions is the disagreement-rate measurement for the N17 benefit-history decision, at finer granularity than benefit grants alone.

Four S1 reports read these tags (actuarialhours, empstatus, disability_without_fmla, autotag_interval — all under `sirius_smf/`). If S2 needs equivalent reports, they run against S2's own computed state, not migrated tags.

`sirius_smf.wym.inc` still creates these nodes daily; it is on the freeze list (§4.17).

> **AMENDED 2026-08-05 (N24):** stage-only is no longer the whole story — **some tags ARE relevant and need migrating**. Most terms are low-value autotag output as analyzed above. **KEEP-LIST RULED same day (closes N24): exactly ONE tag migrates — "Comms: Received Enrollment Packet"**; its S2 home is decided when T29 is built (an offline-comm record per tagged worker-month is the leading candidate). Every other tag stays extract-and-stage as validation evidence.

`field_sirius_json` on this bundle is autotag job bookkeeping only — `{"smf":{"autotag":{"status":{"run_ts","asof_ts"}}}}`, uniform across all rows. Roughly 57,000 nodes lack the JSON row entirely (sparse field).

### 4.3 Grievance domain (Q25 — CLOSED, and descoped)

290 grievance tables exist in production (145 `field_data_*` + 145 `field_revision_*`). They were simply absent from the export.

**However: the `grievance` bundle has 0 nodes.** 89 fields configured, never used.

`04-entity-reassembly.md` row 15 describes grievances as "the one entity where revisions matter" and plans to reconstruct `grievance_status_history` from `field_revision_field_grievance_status`. **There is nothing to reconstruct.** Grievance is a greenfield S2 build, not a migration target. Remove it from ETL scope.

### 4.4 Schema facts confirmed from DDL

- **Zero** views, stored procedures, functions, or triggers. All business logic is in PHP. No hidden database-layer behavior.
- `deleted` is `tinyint(4) NOT NULL DEFAULT 0`. Compare **unquoted**: `deleted = 0`, not `deleted = '0'`.
- `entity_type` and `bundle` are `varchar(128)` — quoted comparison is correct for those.
- Every `field_data_*` table carries a `language varchar(32)` column, absent from the generic join shape in `04-entity-reassembly.md`. **Profiling confirms the only value present across all field tables is `und`** — field translation was never enabled. Safe to ignore in joins.
- **`entity_type` values observed across `field_data_*`: `node`, `taxonomy_term`, `user`, `comment`.** The `entity_type='node'` filter in the reassembly spec is load-bearing — without it, comment, user, and term rows come back from the same physical tables. The presence of `comment` rows is relevant to Q35.
- `field_sirius_ssn_value` is `varchar(255) DEFAULT NULL` — not fixed-width, not unique, nullable. **Q36 (SSN collisions) is confirmed as a real risk**, and format variance (`123-45-6789` vs `123456789`) is unconstrained.

### 4.5 Character sets are not uniform

807 tables are `utf8mb3_general_ci`. **11 are `latin1_swedish_ci`** — custom tables created outside Drupal's schema API, which inherited the server default (`character_set_server = latin1`):

`custom_help_text_roles`, `sirius_denorm_queue`, `sirius_dispatch_elig_cache`, `sirius_hours_cache`, **`sirius_ledger_ar`**, `sirius_ledger_balance`, `sirius_lock`, `sirius_postal_lob_cache`, `sirius_quickhash`, `sirius_sched`, `sirius_trust_wb_scan_changelog`.

Most are caches and drop out of scope. **`sirius_ledger_ar` is in migration scope** and mixes three charsets in one table:

| Column | Type | Charset |
|---|---|---|
| `ledger_status` | `varchar(100)` | latin1 |
| `ledger_memo` | `varchar(255)` | **latin1** |
| `ledger_key` | `varchar(255)` | latin1 |
| `ledger_json` | `longtext` | utf8mb4 |

`ledger_memo` holds free-text financial memos entered by staff, about members with accented names. Non-ASCII content in a latin1 column may **already be corrupted in production** depending on the connection charset at write time. Do not assume clean UTF-8 on read — handle decode failures explicitly and report affected rows rather than coercing silently.

**Also: `utf8mb3` cannot store 4-byte characters.** It is MariaDB's legacy 3-byte UTF-8. Emoji, some CJK, and certain symbols will not round-trip. If S2's Postgres side assumes full UTF-8 capability, the mismatch is one-directional and silent.

`mariadb-dump` writes each table's charset explicitly in the DDL, so loading `s1-schema.sql` reproduces the 807/11 split regardless of the target server's default. This is a verification check: after loading, the collation distribution must be exactly 807 `utf8mb3_general_ci` / 11 `latin1_swedish_ci`.

### 4.6 Financial data lives in two tables

`sirius_ledger_ar` holds approximately 547,000 rows (AUTO_INCREMENT at 547043). `sirius_payment` holds 3,458 nodes. **Both carry real activity.** The balance-parity acceptance test (Q20) must reconcile across both — neither is complete on its own.

### 4.7 Dispatch and skills are OUT OF SCOPE

The BAO does not use dispatch or skills functionality. Do not build ETL for:

- `sirius_dispatch` (51,497 nodes)
- `sirius_dispatch_job` (318)
- `sirius_dispatch_facility` (1)
- All `field_sirius_dispatch_*` and `field_sirius_skill*` fields on any bundle

This closes as out-of-scope, not unanswered: Q3 (availdate semantics), Q4 (HFE scope), Q5 (EBA semantics), Q6 (`asi`), Q7 (skill expire/availx), Q9 (worker→skill), Q22 (dispatch worker ref), Q23 (`cbn`), Q24 (dispatch eligibility wiring).

Note `field_sirius_member_status` also appears on `sirius_dispatch_job` (max_delta 2, 196 rows). Out of scope with the rest.

### 4.8 `member_status` — N12 CLOSED. Maps to `options_worker_ms`, one row per industry

The terms are **industry/policy + hours threshold** eligibility groups (the BAO does not use bargaining units):

| tid | Term |
|---|---|
| 1672 | UNITE HERE Worker — 60 hours |
| 1667 | Event Center Worker — 100 hours |
| 1678 | Unite Here Restaurant Worker — 60 Hours |
| 1628 | Event Center Worker — 80 hours |
| 1666 | Event Center Worker — 60 hours |
| 1673 | PA Worker |
| 1688 | UNITE HERE Worker — 40 Hours |

Distribution: 65,676 workers hold exactly one assignment (97.8%), 1,507 hold two, 14 hold three, 1 holds four. ~42% hold none.

**The co-assignment matrix was checked in production: every multi-assignment pair crosses industries.** No worker holds two terms in the same industry. Therefore the mapping is mechanical:

- Each term → `options_worker_ms` keyed by `sirius_id` = tid, with `industry_id` derived from the term name (UNITE HERE / Event Center / Restaurant / PA — confirm against `options_industry` rather than string-parsing).
- One `worker_msh` row per worker per industry.
- **Delta order is NOT meaningful** (reverses v4). The same pair appears with either term at delta 0; industry disambiguates, so delta can be dropped entirely.
- All taxonomy weights are 0 — no vocabulary ordering exists either.

### 4.8a Employment status is DERIVED, not stored — by design

`field_sirius_work_status` on workers is vestigial: **2 rows** in production (down from an apparent 167 in the aggregate profile; the live check found 2 current rows, both from July 2025). The `sirius_work_status` vocabulary (Active, Disability, FMLA, Laid Off, LoA, Military Leave, On Leave, On Withdrawal, Retired, Terminated, Deceased — with duplicate legacy terms) is NOT the employment-status source.

**Employment status comes from hours.** A worker's state at an employer is derived from the hour type of their most recent payperiod at that employer. It is inherently per-employer — a worker can be Terminated at one shop and Active at another — which is why S1 deliberately does not store a worker-level employment status. **Do not create one in migration.**

Consequences:
- T6 / `worker_wsh`: **nothing to build.** Drop the work-status revision reconstruction entirely.
- `worker_hours.employment_status_id` maps from the payperiod's hour type (see §4.12).
- The `sirius_work_status` vocabulary itself: do not migrate as status. If S2 needs the term list for hour-type mapping, take it from `sirius_hour_type` instead (§4.12).

### 4.9 Worker identifiers — four distinct types (Q2, Q8 CLOSED)

Confirmed from S1 field labels and the worker edit form:

| S1 field | Label in S1 UI | Example |
|---|---|---|
| `field_sirius_id` | **Sirius ID** | `671794` |
| `field_sirius_id2` | **Union ID** | (often blank) |
| `field_sirius_id3` | **External ID** | `U05990600` |
| `field_sirius_aat` | **AAT** | `6917` |

**AMENDED 2026-08-06 (fund ruling):** `field_sirius_id` does NOT become a `worker_ids` row — it maps exactly to `workers.sirius_id` itself (the id spaces were verified on production: nid ≈ 2.4M node counter, field_sirius_id ≈ 600k business series, zero overlap). The S1 `nid` is preserved as a new `worker_ids` type **"Legacy NID"** (seeded `sirius_id='s1-legacy-nid'`). `_id2` → "Union ID", `_id3` → "External ID", `_aat` → "AAT" `worker_ids` rows are unchanged. AAT is an identifier, not a measurement — Q8's observation that values `365 / 415499 / 92464` "defy single-unit interpretation" is explained: they are variable-length IDs from an external system, not quantities.

`field_sirius_id` carries different meanings on other bundles: **Call Number** on `sirius_dispatch_job`, **ListID** on `sirius_member_status` terms, plain "ID" elsewhere.

`field_sirius_id2` on `sirius_work_status` taxonomy terms is labeled **"Titan ID"** — an external system not referenced anywhere in this spec. Open item.

### 4.10 Count fields (Q14 CLOSED)

| Field | Bundle | Label |
|---|---|---|
| `field_sirius_count` | `sirius_contact_relationship` | **Sequence** (ordering, not a quantity) |
| `field_sirius_count` | `sirius_contact_relationship_types` | Maximum Count |
| `field_sirius_count` | `sirius_dispatch_job` | Worker Count (out of scope) |
| `field_sirius_count_yes` | `sirius_dispatch_job` | Accepted Count (out of scope) |

Note the relationship one is a **sequence**, not a count — different semantic than the original spec inferred.

### 4.11 `ledger_memo` non-ASCII — measured, not systemic

97 rows out of 261,640 (0.037%) contain bytes outside ASCII. `settings.php` sets no connection charset, so D7 defaults to `utf8` and MySQL transcodes UTF-8 → latin1 on write.

No repair project is warranted at this scale. **ETL requirement stands:** fail loudly on any decode problem, log the affected `ledger_id`, do not silently coerce. Note that characters outside latin1's repertoire (CJK, emoji) were lost at write time and are unrecoverable.

---

### 4.12 `sirius_payperiod` — hours live inside the JSON payload (Q21 CLOSED)

> **Task 414 (2026-08-28):** pay-period provenance is now persisted — T20
> upserts an id_map `payperiod` crosswalk (nid → monthly `worker_hours.id`)
> after each verified run, the permanent money order is payments → hours →
> ledger so T18 resolves AR pay-period references as hour links, and the BAO
> hourly plugin treats linked `s1-import` entries as the historical billing
> base. Pre-order data is fixed once via `repair-hour-links.ts` (RUNBOOK
> §10.1).

The bundle's 12 fields include no hours amount and no hour-type reference. Both live in `field_sirius_json`. Structure, confirmed against all 3,615,475 rows:

**Modern format — 3,615,465 rows (99.9997%), depth 10:**

```json
{
  "entries":   { "<source>": ... },        // source ∈ import | upload | manual (+ rare nid keys)
  "totals":    { "hours": {
                   "total":        <number>,   // THE hours figure
                   "by_type":      { "<hour_type_tid>": ... },
                   "by_dept":      { ... },
                   "by_type_dept": { ... },    // denormalized pivots —
                   "by_dept_type": { ... },    // recompute in S2, do not migrate
                   "by_day":       { ... }
                 } },
  "reconcile": { "msg": ..., "status": ... },  // status present on only 35 rows
  "smf":       { ... }                          // present on ~1.36M rows (autotag block)
}
```

**Legacy format — exactly 10 rows, depth 6:** `entries` is an ARRAY, totals is `{daily, monthly, payperiod}`, no reconcile. **N18 closed:** nids 2163305, 2163316, 2163342, 2163497, 2163502, 2163517, 2163532, 2163752, 2163972, 2163978 — all created within 70 seconds on 2019-12-02, the very first payperiod inserts (a historical backfill; two claim periods from 2003). **Disposition: documented skip.** Log the nids and reason `legacy_json_format`; do not build a parser for them.

Critical extraction facts:

1. **`totals.hours.total` is the hours figure.** JSON type is INTEGER on 1,981,145 rows and DOUBLE on 1,634,320 — parse as decimal ALWAYS. A parser that infers int-vs-float per row will produce inconsistent types in one column.
2. **`by_type` is keyed by `sirius_hour_type` tid**, and every row observed has exactly ONE type key. Read as a map, expect one entry. Live tids and volumes: 1544 Active (3,581,765), 1682 No Charge (14,118), 1637 Terminated (7,135), 1634 LOA (6,948), 1633 FMLA (2,995), 1632 Disability (2,427), 1635 Military Leave (38), 1691 Initial Eligibility (13), 1662 Deceased (11), 1701 Event Center Hours Purchasing (10), 1636 COBRA (5).
3. **Five vocabulary terms never occur in data** (900-series legacy generation): Apprentice 908, Community Service 936, EAC 935, Reconciliation 974, Vacation 907. The hour-type mapping table needs only the 1600-series plus 1544.
4. **`entries` keys are provenance** — `import` (3,299,233), `upload` (313,331), `manual` (2,798) — but 71 rows have numeric nid keys (16357282, 12315497). Treat unknown keys as valid; do not assume a closed enum.
5. **`worker_hours.employment_status_id` derives from `by_type`** per §4.8a: most recent payperiod's hour-type tid at that employer is the worker's state there.

### 4.13 Benefit history — extract and stage, do not drop (STRATEGY REVISION)

`04-entity-reassembly.md` row 7 classifies `sirius_trust_worker_benefit` (609,486 rows) and `sirius_trust_wb_scan_changelog` as DROP, on the theory that S2 regenerates `trust_wmb` from migrated elections + hours.

**That plan has a flaw: regeneration applies today's rules to yesterday's months.** Eligibility rules changed over time and S1 recorded no policy history. Manual overrides and corrections exist only in what S1 actually granted. And granted coverage cannot be retroactively revised — revoking a granted month creates a COBRA event — so for the past, **S1's granted record is the truth regardless of what any rule computes.**

Revised classification:

| Data | Old | New |
|---|---|---|
| `sirius_trust_worker_benefit` (609K) | DROP | **EXTRACT AND STAGE** — land in a staging table, do not load to S2 `trust_wmb` |
| `sirius_trust_wb_scan_changelog` | DROP | EXTRACT AND STAGE (same treatment) |

The forward-looking plan is unchanged: S2's scan generates coverage going forward under versioned policy history.

> **N17 CLOSED (2026-08-05, fund ruling): IMPORT DIRECTLY — do NOT rebuild from elections+hours.** S1 recorded no policy history, so regeneration is not viable at all; the disagreement-rate plan below is retired as the decision input. Migrate the raw `sirius_trust_worker_benefit` records **in full — NO cutoff (amended 2026-08-05: import everything from S1 to S2)** into S2 (T17 becomes an import loader, staging → `trust_wmb` via storage). **S1 remains system of record through the transition date.** Validation shifts to the month-parity run (§9 item 10): compute a comparison month in S2 and compare outputs against S1.

~~The backward-looking decision — import S1 history vs. regenerate-and-reconcile — is **deliberately deferred** (N17). The staged extract enables the deciding evidence: run S2's regeneration in staging, diff against S1's actual grants, and report the disagreement rate. A low rate supports regeneration with manual reconciliation; a high rate forces import. Nobody can make this call until the number exists.~~

~~**Validation plan addition:** regenerated-vs-actual diff over the staged benefit history, disagreement rate as a deliverable, routed to Kristin with N17.~~ *(Superseded by the 2026-08-05 ruling above.)*

### 4.14 `node.changed` is a REAL timestamp (N16 closed — reverses the prior caveat)

The full monthly distribution of `changed` runs continuously from 2011-09 to the present with no uniform collapse. The earlier claim that it was an anonymization artifact came from the 10-row sample. **`changed` is usable as a business timestamp.** Remove any ETL logic that avoids it.

Real mass-touch events visible in the distribution (each a system-wide backfill or process run): 2023-06 (1.89M nodes), 2024-03 (1.35M), 2025-07 (754K), 2025-04 (642K), 2024-01 (453K). Records touched in those months carry a `changed` reflecting the event, not a human edit.

Bundle ages from `MIN(created)` reshape backfill scope: `sirius_log` dates to 2011, `sirius_payperiod` to 2019-12, but the trust side is young — `sirius_worker` 2023-01, `smf_worker_month` 2023-10, **`sirius_payment` 2024-11**, `sirius_trust_provider` 2025-06. Payment nodes simply do not exist before Nov 2024.

### 4.15 Carrier consolidation (N5 closed — requires a hand-authored mapping)

> **RULING 2026-08-05: DO NOT TRANSFORM AT MIGRATION — carry providers and benefits over as-is from S1.** Benefit consolidation/splitting (Carelon, VSP, and the alias groups below) is **deferred to a later S2 phase**; the alias→canonical table (N19) becomes a later-phase input, not a load blocker. Noted for that later phase: a display enhancement showing which primary benefit grants a linked benefit ("You have VSP because you have MLK").

The 12 `sirius_trust_provider` nodes and the 20+ `Benefit:` tags do not map 1:1 to real carriers. Confirmed identity groups:

| Canonical carrier | Aliases in S1 data |
|---|---|
| UNITE HERE Dental Center | Dentwell, LA Dental Center, Dyntl, UHDC, LADC |
| MLK (dental benefit) | MLK/MHM/DBA (former administrator), MLK/Logix (current administrator) |
| Express Scripts | tids 1686 and 1641 (duplicate benefit tags) |
| Carelon | Carelon EAP (1640), Carelon Behavioral Health (1639) — confirm whether distinct products or duplicates |

Consequences:

1. **A `sirius_id`-keyed carry-over of providers creates six carriers where there is one.** The migration needs an explicit alias→canonical mapping table, authored by the fund, not derived.
2. Administrator is an attribute of a benefit arrangement (MLK: MHM/DBA → Logix), not part of carrier identity. S2's model should hold administrator separately if it matters for routing or reporting.
3. Benefit tags reference carriers absent from the provider list (United Concordia, EHS) and vice versa — the mapping table must cover both sets.

### DRAFT alias→canonical carrier table (2026-08-04, from prod §P3 lists — PENDING FUND SIGN-OFF)

Covers all 12 `sirius_trust_provider` nodes and all 20 `Benefit:` tags. The fund corrects the "Canonical carrier" column and answers the ❓ rows; nothing loads until signed off (N19).

| Canonical carrier (proposed) | Provider node aliases (nid) | Benefit-tag aliases (tid) | Notes / fund decision needed |
|---|---|---|---|
| Carelon | Carelon (15546982) | Carelon Behavioral Health (1639), Carelon EAP (1640) | **2026-08-04 (Sam): two DIFFERENT benefits, one consolidated EDI file.** Kaiser/HealthNet medical → EAP only; MLK medical → EAP + BH. The EDI flags the member's medical provider so Carelon grants the right product. S2 may simplify to a single Carelon — **ruling still out** (affects benefit modeling, not carrier identity: one carrier either way) |
| Delta Dental | Delta (15386513) | Delta (1561) | |
| UNITE HERE Dental Center | Dentwell (15544902) | LA Dental Center (1643) | Known aliases: Dentwell, LADC, UHDC, Dyntl |
| Express Scripts | Express Scripts (15381074) | 1641 AND 1686 (duplicate tags, same name) | Both tids → one carrier |
| Health Net | HealthNet (15403852) | Health Net (1563) | |
| Hinge Health | Hinge (15377370) | Hinge PT (1642) | |
| Kaiser | Kaiser (15386512) | Kaiser (1564), Kaiser E (1614) | **Kaiser E is historical/legacy** (2026-08-04, Sam) — same carrier, no active feed for the E variant |
| Liberty | Liberty (15412953) | Liberty (1565) | |
| MLK | MLK/Logix (16988232), MLK/MHM/DBA (15547119) | MLK (1567) | ONE carrier; administrator (MHM/DBA → Logix) is an arrangement attribute, not identity |
| Progyny | Progyny (17540659) | Progyny (1705) | |
| VSP | VSP (15283174) | VSP (1568), VSP Enhanced (1645) | **CORRECTED 2026-08-04 (Sam): VSP Enhanced is LIVE, not legacy** — works like Carelon: MLK medical → VSP Enhanced; HealthNet/Kaiser medical → VSP. One carrier, two benefits; S2 may consolidate to one benefit — **ruling outstanding**, disregard consolidation for the importer |
| Life | — none — | Life Insurance / AD&D (1566) | **2026-08-04 (Sam): 1566 is "Life"** — a benefit with NO provider feed (no carrier EDI) |
| AD&D | — none — | AD&D (1638) | **2026-08-04 (Sam): remains "AD&D"**, distinct from Life — also NO provider feed |
| EHS (historical) | — none — | EHS (1569) | **Historical/legacy** (2026-08-04, Sam) — no active feed; carried only for benefit history |
| United Concordia (historical) | — none — | United Concordia (1576) | **Historical/legacy** (2026-08-04, Sam) |
| Placeholder Historical Dental Plan (historical) | — none — | Placeholder Historical Dental Plan (1575) | **Historical/legacy** (2026-08-04, Sam) |

**FUND SIGNED OFF 2026-08-04 (Sam) — table is authoritative for the importer.** The only outstanding rulings are the Carelon and VSP benefit-consolidation questions (one benefit vs medical-provider-dependent pairs) — both are S2 benefit-modeling decisions, explicitly **disregarded for the importer**: migrate the benefits as they exist in S1. Life and AD&D have **no provider feeds** — benefits without carrier EDI, which the S2 benefit loader must model as feed-less.

### 4.16 Secrets in the `variable` table (Q33 closed — rotation required at cutover)

The `variable` table (~3,300 rows, names prefixed `<domain_nid>/` for per-domain values; domains: -1 global, 2124505, 2314159, 2314283, 2408331, 2457501) contains live credentials in plaintext:

| System | Keys | Scope |
|---|---|---|
| AWS S3 | `s3fs_awssdk2_access_key` / `_secret_key` | global — **reaches the member-document bucket (14,636 files, 20.8 GB)** |
| Stripe | live account secret, test account secret, webhook endpoint secret | domain 2457501 |
| Twilio | account_sid, account_token, app_sid | global + 5 domains, plus `tfa_basic_*` |
| Okta | `sirius_okta_token` | global |
| SMTP | `smtp_password` | global + 2 domains |
| TIMSS | `grievance_timss_token` | global + 4 domains |
| iMIS | `grievance_workersync_imis_apikey` | 4 domains |
| Phaxio | api_key, api_secret, callback_token | global |
| SAML | `samlauth_sp_private_key` | global |
| Drupal | `drupal_private_key`, `cron_key`, `mimemail_key` | global |
| Weglot, geocoders | 1 + 9 API keys | global |

Rules (restating and extending the standing rule):

1. `variable` **never bulk-migrates.**
2. Secrets move to the S2 secret store, preserving per-domain scoping.
3. **Everything above rotates at cutover** — these values have circulated through years of dumps and copies. S3 first (it reaches PHI), when S1 goes read-only.
4. Non-secret variables migrate as configuration with domain scope preserved, after a manual review pass.

The S3 credential scope check and the file-migration workstream (21,029 `file_managed` rows — 14,636 on s3/private, ~6,400 elsewhere unaccounted for; 12,643 CSVs pending a keep/drop decision) are with Sam as a separate case.

### 4.17 Freeze-window writer list (N15 closed — empirical, 14-day window)

Bundles with nodes created in the last 14 days of production activity:

| Writer | created/14d | changed/14d | Note |
|---|---|---|---|
| `sirius_log` | 73,797 | 73,850 | logging — freeze-irrelevant but noisy |
| `smf_worker_month` | 4,922 | 5,366 | wym.inc + autotag |
| `sirius_payperiod` | 3,822 | 5,292 | hours imports |
| `sirius_trust_worker_benefit` | 3,405 | **18,289** | scanner — **updates 5× more than it inserts**; §4.13 staging extract must happen at freeze, these rows are moving |
| `sirius_trust_worker_election` | 200 | 359 | elections |
| `sirius_payment` / `sirius_contact` / `sirius_worker` | ~120 each | — | normal operations |
| `sirius_feed`, `sirius_contact_relationship`, `sirius_phonenumber`, `sirius_employer_payperiod`, `sirius_employee` | <70 each | — | normal operations |

The freeze plan must stop: hours imports, the benefit scanner, wym.inc/autotag, election processing, and payment entry. `sirius_employer_payperiod` was written the day of profiling — it is live and needs a mapping (N3 remains open).

### 4.18 Ledger and payment facts (Q19, Q20 partial, N6 shaped)

From production aggregates:

- `sirius_ledger_ar`: 261,808 rows, **all status `Cleared`** — Q19 closed, S2's status-less ledger needs no policy for pending/void.
- Sign convention: positive = charges (253,421 rows, +$199.3M), negative = payments/credits (8,334 rows, −$188.5M), 53 zero-amount rows.
- `ledger_key`: numeric on 98.7%, empty on 3,384 — nullable, no parsing rule.
- `ledger_reference` is never null; 8,334 negative rows resolve to 7,912 distinct references — **payment→ledger is one-to-many** (allocation splits). Ledger rows cannot be reconstructed from payments; both stores migrate independently.
- Payment statuses: Failed (11), Pending (105), Received (12) have **zero** ledger rows — never written, correctly excluded. **8 of 122 Canceled payments have ledger rows** — cleared-then-canceled without reversal. This is a live S1 data-integrity item under active remediation by the fund, NOT an ETL edge case.

**Q20 revision — parity is measured, not asserted.** S1's ledger numbers are changing under active remediation. Do NOT pin a dollar figure as an acceptance target. The test: S2's computed balance equals S1's *at the freeze snapshot instant*, whatever that value is, reported per-participant and per-account so discrepancies are diagnosable. **The ETL must not silently normalize** — any status/ledger disagreement at migration time is reported, never reconciled in flight.

### 4.19 Smaller closures from production profiling

**Q36 — SSN quality.** 105,798 SSNs, uniformly `nnn-nn-nnnn` (zero unformatted). Normalization = strip dashes. Exactly **one** true duplicate pair (two workers, one SSN) — manual review item. **11,839 workers (10%) have NULL SSN** — expected: dependents are workers and SSN is not required for them. Fund decision: missing-SSN workers migrate into a **review queue**, not rejected.

**Q39 — opt-outs do NOT exist in S1.** `sms_possible` is Yes on all 3,952 rows; no unsubscribe field exists (the only dnc-ish fields are dispatch, out of scope). Opt-out state, if any, lives at the provider level (Twilio auto-honors STOP at the carrier; SendGrid holds bounces/unsubscribes). **BLOCKER FOR FIRST SEND, not for migration:** S2 must query provider opt-out lists at cutover before any communication to migrated contacts. Owner: Sam / Luis.

**Q29 — `sirius_log` types.** 80+ ad-hoc free-text values (mixed case, typos, trailing spaces, one null). 59% of all logs are a single automated type (`terminated`, 1.05M rows). Disposition: **cold archive by default.** Only SMS-lifecycle types (`outgoing_sms`, `incoming_sms`, `delivered`, `undelivered`, `failed`, `Bounce`, `sending`, `sent`) map to `comm`/`comm_sms`. The hand-built MSR call-reason values (MLK Issues, ID card not received, Appeal Denial, …) go to Luis: does S2 want them as structured call reasons?

**Q10 — preferred language.** 10 distinct values: en 683, es 648, tl/fil 7 (both are Tagalog/Filipino — normalize to one), zh-hans/zh-hant 3, ar/ko/th 1 each, en-gb 2 (browser artifact). **Resolution: add a language column to `contacts`.** Comms depend on it; `data` jsonb is not queryable enough.

**Q34 — flags.** One flag type: `bookmarks`, 225 flaggings on nodes. Straight map to S2 `bookmarks`. No workflow markers exist.

**N8 — small bundles.** `grievance_company` rows are test data (ACME Co., Bravo Blaster Co., anaheim hilton) — DROP after confirming the anaheim hilton row is not referenced. `grievance_chapter` rows (Dispatch Office, Training Center) are dispatch-adjacent — DROP with dispatch. `sirius_twilio_conversation` (8 nodes, 2018) — DROP.

**N4 — `sirius_employee` is live** (created through yesterday, 541 rows, bundle dates from 2024-07). Working hypothesis: worker↔employer employment link with an external employee code. Recent enough that its author remembers why it exists — ask Sam. Mapping still open.

---

## 5. Timezone conventions — RESOLVED

The timezone item in `05-open-questions.md` is closed. This section is **mandatory reading before writing any date transform.**

> **2026-09-03 — implementation contract added.** S2 now interprets every
> no-zone `timestamp` column in its *system* zone (`TZ` at boot). The
> migration therefore **pins the S2 system zone to `America/Los_Angeles`**
> (the same zone this section documents for Drupal) and every migration
> process refuses to write in any other zone. The per-field rulings below are
> unchanged; how each category is carried into S2 against that pin — and how
> per-*user* zones are kept out of the ETL — is in
> [03-transformations.md → "Time zone contract"](03-transformations.md#time-zone-contract-system-zone-pin--2026-09-03)
> and RUNBOOK §1 "Time zone pin".

All 22 date fields in S1 are D7 `datetime` **string** columns — none are integer Unix timestamps. (`node.created` and `node.changed` remain integers and are timezone-independent.)

Drupal site config: `date_default_timezone = America/Los_Angeles`, `configurable_timezones = 1`, `user_default_timezone = 0`.

D7's Date module sets `tz_handling` **per field**, and S1 uses two different conventions:

### Stored as LA wall time (`tz_handling: none`) — parse literally, NO conversion

| Field |
|---|
| `field_sirius_dob` |
| `field_sirius_date_start` |
| `field_sirius_date_end` |
| `field_sirius_skill_expire` |
| `field_sirius_dispatch_eba_dates` |
| `field_grievance_alert_date` |
| `field_grievance_alert_waived` |
| `field_grievance_date` |
| `field_grievance_date_1` |
| `field_grievance_date_2` |
| `field_grievance_hire_date` |
| `field_grievance_meeting_date` |
| `field_grievance_resproc_cd` |
| `field_grievance_resproc_hd` |
| `field_grievance_status_date` |
| `field_grievance_valid` |

### Stored as UTC (`tz_handling: site`) — convert UTC → America/Los_Angeles

| Field |
|---|
| `field_sirius_datetime` |
| `field_sirius_datetime_created` |
| `field_sirius_datetime_completed` |
| `field_sirius_dispatch_availdate` |
| `field_sirius_daterepeat` |
| `field_sirius_dispatch_hfe_until` |

### Why this matters

Getting a field's convention backward shifts it by 7–8 hours. Three cases where that is materially damaging:

1. **`field_sirius_dob` is `none`.** Read as UTC and converted, any DOB before 08:00 slips backward one calendar day. Age drives dependent eligibility and Medicare coordination.
2. **`field_sirius_date_start` / `field_sirius_date_end` are `none`.** Coverage boundaries. A one-day slip changes which month a member was covered — and retroactively revoking a granted month creates a COBRA event.
3. **`field_sirius_datetime_created` is `site`.** Payment timestamps feed late-fee assessment, which uses strictly-before boundary windows anchored to the 1st of the month. A payment at `2026-03-01 02:00` UTC is `2026-02-28 18:00` LA — the other side of the boundary.

### DST handling

The `none` fields are LA wall time and therefore subject to daylight saving transitions:

- `2026-03-08 02:30` **does not exist** (spring forward)
- `2026-11-01 01:30` **occurs twice** (fall back)

Parse `none` fields as naive local time and handle nonexistent/ambiguous values **explicitly**. Do not let the datetime library resolve them silently — log and report affected rows.

This resolves the observation in `05-open-questions.md` that `field_sirius_skill_expire` (13:12) and `field_sirius_dispatch_availdate` (20:12) appeared 7 hours apart. They are the same instant expressed in the two different conventions.

---

## 6. Traps for the ETL developer

| Trap | Handling |
|---|---|
| `field_grievance_shop` on `smf_worker_month` is the **employer** reference | The `grievance_` prefix is a Drupal module namespace, not a domain marker. Do not infer domain from field-name prefix |
| `sirius_phonenubmer` (7 nodes) coexists with `sirius_phonenumber` (3,952) | Misspelled content type in production. Handle both or explicitly skip the 7 with a logged reason |
| `deleted` is an integer | Unquoted comparison: `deleted = 0` |
| `language` column | Uniformly `und`; safe to ignore, but do not assume for future data |
| `entity_type` filter | Load-bearing — field tables also hold `taxonomy_term`, `user`, and `comment` rows |
| `node.changed` uniform value | Was an anonymization artifact in the old sample. **Re-verify against real data** — may not hold in production |
| Multi-value fields | Do not flat-join. Use `fielddata_stats.tsv` `max_delta` to identify which |
| Date fields | Two timezone conventions — see §5. Never assume |
| `ledger_memo` charset | latin1; may contain pre-existing corruption. Fail loudly, do not coerce |

---

## 7. Development environment

**The Neon Postgres database is retired. Do not build against it.**

**Dev target is live:** MariaDB 10.6.25, all 818 tables loaded, zero rows. Connection string in Secrets as `S1_DATABASE_URL`. Verified against production on version, table count, and collation distribution (807/11).

**TLS must be disabled for the dev connection** (`ssl: false` / `--ssl=0`). The dev instance is a plain Docker image without certificates. **This is a dev-only exception.** The production connection runs inside the HIPAA boundary and TLS is mandatory there — unencrypted PHI in transit is a compliance problem. Do not carry dev connection settings forward to the production DSN.

**Production server configuration**, relevant to read design:

| Variable | Value | Implication |
|---|---|---|
| `max_allowed_packet` | 16777216 (16 MB) | Ceiling on any single row/blob read |
| `net_read_timeout` | 30 | Long reads must stream, not block |
| `wait_timeout` | 28800 | 8 hours |
| `time_zone` | UTC | Server-level only — see §5 for what values mean |
| `character_set_server` | latin1 | Explains the 11 latin1 tables |

**Rationale for synthetic data:** production data is PHI. Rather than anonymizing an export (which requires scrubbing free text — `ledger_memo`, `field_sirius_notes`, `field_grievance_description` — and being correct about all of it), the dev database is generated. Nothing sensitive exists outside the HIPAA boundary at any point.

The generator will deliberately seed edge cases that a row sample would not contain:

1. `delta > 1` multi-value rows
2. `deleted = 1` rows requiring filtering
3. `entity_type` values of `taxonomy_term`, `user`, and `comment` in field tables shared with nodes
4. `node.status = 0` unpublished
5. Sparse fields (LEFT JOIN null path) — including `smf_worker_month` rows with no JSON
6. Orphan `*_target_id` references pointing at missing nids
7. SSN collisions and format variants
8. nids spanning the real range (~2.4M–22M) — do not assume small integers
9. Date values inside DST gap/overlap windows (§5)
10. Non-ASCII content in latin1 columns

**Standing rule:** the migration tool, when pointed at production, emits **only aggregates and counts**. No sample rows, ever, in validation output or logs.

---

## 8. Open questions

| # | Question | Owner |
|---|---|---|
| N3 | `sirius_employer_payperiod` (18,412, written today) — employer-side period tracker. Map to `wizard_employer_monthly` or drop? Needs a mapping decision | Mitchell / Sam |
| N4 | `sirius_employee` (541, live) — what UI feature uses it? | Sam |
| N6 | Balance-parity test design: reconcile `sirius_ledger_ar` and `sirius_payment` independently at freeze snapshot (§4.18) | Laura / Sam |
| N7 | 16 configured-but-empty bundles — abandoned or purged? | Sam |
| ~~N17~~ | **CLOSED (2026-08-05, fund ruling): IMPORT DIRECTLY, do not rebuild.** S1 recorded no policy history, so regenerating benefit records from elections+hours is not viable. Migrate raw `sirius_trust_worker_benefit` records in full — NO cutoff (amended 2026-08-05: import everything); S1 remains system of record through the transition date. The regenerate-vs-actual diff is retired as the decision input; validation is the month-parity run instead (§9 item 10) | — |
| N19 | Carrier alias→canonical mapping table (§4.15) — **DEFERRED (2026-08-05 ruling):** providers/benefits import as-is from S1, no consolidation at migration time; the alias table is a later-S2-phase input, not a load blocker | Mitchell / Kristin |
| N20 | Opt-out inheritance from Twilio/SendGrid before first S2 send (§4.19/Q39) | Sam / Luis |
| N21 | MSR call-reason taxonomy from log types — structured in S2 or archived? | Luis |
| N22 | File migration workstream: S3 credential scope, the 12,643 CSV keep/drop decision, and the ~6,400 files not on s3/private | Sam |
| N23 | Carelon EAP vs Carelon Behavioral Health — distinct products or duplicate tags? | Kristin |
| OPEN-1 | `field_sirius_payperiod_type` vocabulary and meaning | Mitchell |
| ~~OPEN-2~~ | **CLOSED (2026-08-04, Sam):** S2 has NO persistent notion of S1 employment status — it is NOT migrated as a fidelity obligation. (Mechanically, `worker_hours.employment_status_id` is `NOT NULL` in S2 today, so T20 keeps the tid→status-name mapping purely to satisfy the column; if the column is ever relaxed the mapping can drop with no migration-fidelity impact.) | — |
| ~~OPEN-3~~ | **CLOSED (2026-08-05, ruling): IMPORT AS-IS.** The 381 negative-hours payperiods are BPA-era legacy corrections; no charges are generated from negative hours, and they must be kept for pension vesting history. T20's current load-as-is behavior stands unchanged | — |
| ~~N24~~ | **CLOSED (2026-08-05, fund ruling): keep-list = exactly ONE tag, "Comms: Received Enrollment Packet".** All other `sirius_contact_tags` terms stay extract-and-stage (§4.2). The kept tag's S2 home is decided at T29 build time (offline-comm record per tagged worker-month is the leading candidate) | — |
| ~~N25~~ | **CLOSED (2026-08-05, ruling): WIDEN TO MULTI-LINK — shipped same day.** `employer_contacts` storage now enforces uniqueness on (contact, employer, type) instead of the pair; the T24 loader creates one link per resolved type (co_role first, then term order), heals prior single-link rows (untyped link retyped to the first missing type), keeps operator-added links. Prod expectation: 557 contacts → ~920 links, 0 assignments lost (07 §P5) | — |
| ~~N26~~ | **CLOSED (2026-08-05, ruling): DEFAULT-DATE the 115, S1-FIXED the 2 — shipped same day.** Missing-start relationship rows load with start `2000-01-01` + end `2000-01-02` (a real S1 end date is kept; `data.datesDefaulted=true`). The 2 future-start rows were corrected directly in S1 by the fund, so `future_start_date` stays a fatal tripwire (expect 0), as do `bad_start_date`, `bad_end_date`, `end_before_start` (07 §P6) | — |
| ~~OPEN-5~~ | **CLOSED (2026-08-04, prod P2): 0 boundary-spanning payperiods in production.** Attribution question is moot; T20's `boundarySpanningPeriods_OPEN5` counter stays as a tripwire that must read 0 in the production run report | — |

**Closed:** Q0, Q2, Q8, Q10 (language column on contacts), Q14, Q19 (all ledger rows Cleared), Q21 (hours at `$.totals.hours.total`), Q25, Q29 (cold archive + SMS types), Q32, Q33 (secrets inventory, §4.16), Q34 (one bookmarks flag), Q36 (one duplicate pair; 11,839 nulls → review queue), Q37 (industry in member-status terms), Q39 (no opt-out state in S1 — provider-level, N20), N1, N2, N5 (carrier consolidation, §4.15), N9 (four consumers), N10 (contact wins; worker email is a mirror), N11 (tags are computed state → extract-and-stage), N12 (co-assignments always cross industries), N13 (employment status derived by design), N14 (opaque strings, no validators), N15 (freeze list, §4.17), N16 (`changed` is real, §4.14), N18 (10 legacy rows identified, documented skip), timezone convention, OPEN-4 (900-series hour types never occur in data — dead generation), **OPEN-3** (2026-08-05: negative hours import as-is — BPA-era corrections, kept for pension vesting), **N17** (2026-08-05: benefit history imports directly — no policy history, recompute not viable), **Carelon/VSP consolidation** (2026-08-05: no transform at migration — carriers/benefits carry over as-is; splitting deferred to a later S2 phase), **N24** (2026-08-05: keep-list = one tag, "Comms: Received Enrollment Packet"), **N25** (2026-08-05: `employer_contacts` widened to multi-link — shipped), **N26** (2026-08-05: missing-start relationships default-dated 2000-01-01/2000-01-02 with real ends kept; the 2 future-starts fixed in S1).

**Closed as OUT OF SCOPE** (dispatch/skills, §4.7): Q3, Q4, Q5, Q6, Q7, Q9, Q22, Q23, Q24.

**Remaining unknowns needing a human:** the open-questions table above. Q15 (`sirius_id` meaning on remaining bundles) folds into per-bundle mapping work.

---

## 9. Validation

Before ETL work resumes:

1. `grep -c "^CREATE TABLE" s1-schema.sql` = 818 — schema is complete
2. `grep -c "^INSERT INTO" s1-schema.sql` = 0 — no data present
3. Dev instance reports `10.6.25-MariaDB` — dialect matches production
4. Dev collation distribution is exactly 807 `utf8mb3_general_ci` / 11 `latin1_swedish_ci`
5. Rewritten profiler runs against dev and produces output matching `profile/*.tsv` in shape
6. `01-field-inventory.md` regenerated from `columns.tsv`; every type inference replaced with a real `column_type`
7. All SQL in `04-entity-reassembly.md` executes without error against the dev instance
8. A reassembly query for one bundle with a known `max_delta > 0` field returns the correct row count — proving the multi-value path is handled
9. A date transform test covering both `tz_handling` conventions and both DST edge cases
10. **Month-parity run (ruling 2026-08-05, replaces the N17 regenerate-vs-actual diff):** after the data load, run S2's computations for a comparison month (e.g. July) and compare outputs against S1's for the same month — validates both data accuracy and rule parity before cutover. S1 remains system of record through the transition date.

---

## 10. What to do first

1. Read `columns.tsv`. Regenerate `01-field-inventory.md` from it. Discard the old type column entirely.
2. Rewrite every SQL fragment in `04-entity-reassembly.md` for MySQL dialect.
3. Add the §5 timezone table to `03-transformations.md` as a mandatory per-field rule.
4. Remove from ETL scope: grievance (§4.3), the 16 empty bundles (§4.1), dispatch and skills (§4.7), `sirius_twilio_conversation` / `grievance_company` / `grievance_chapter` (§4.19).
5. Reclassify as EXTRACT-AND-STAGE: `sirius_trust_worker_benefit` + scan changelog (§4.13), `smf_worker_month` + its tags (§4.2). Staging extract runs at freeze — these tables are being actively rewritten (§4.17).
6. Build member-status migration per §4.8: term → `options_worker_ms` by tid, one `worker_msh` row per industry, delta dropped.
7. Do not build `worker_wsh` (§4.8a). Do not create worker-level employment status anywhere.
8. Build the payperiod JSON extraction per §4.12 — `totals.hours.total` as decimal, `by_type` tid mapping, provenance from `entries`, the 10 identified legacy nids skipped.
9. Remove the `node.changed` avoidance — it is a real timestamp (§4.14).
10. Add the carrier alias→canonical mapping step (§4.15) as a lookup table with fund-authored content (N19 pending).
11. `variable` never bulk-migrates; secrets per §4.16.
12. Update mapping for: `sirius_employer_payperiod` (N3 pending), `sirius_employee` (N4 pending), `sirius_trust_provider` (via §4.15).
13. Flag anything in `02-mapping.md` marked *(inferred)* that depended on sample values — re-derive.

Do not write ETL code that connects to production. The reader module takes its DSN from `S1_DATABASE_URL`; the production DSN is supplied only inside the HIPAA-scope deployment.

---

## Addendum 2026-08-06 — T16–T19 operational notes

- Load order through the ledger milestone: … relationships → employee-ids → elections (T16) → benefit-history (T17) → **payments (T19) → ledger (T18)** → hours. T19 before T18 is load-bearing (AR allocation rows reference payment nids).
- Open-span horizon (`--open-end-through`) needs a fund ruling before the prod T17 run; freeze month is the working candidate.
- Ledger accounts: id_map `ledger-account` → adopt by exact name → create. A broken id_map row (points at a deleted account) fails loud — repair the map.
- The migration scripts are OUTSIDE the app tsconfig. `npx tsc -p tsconfig.scripts.json --noEmit` is mandatory after touching loaders — the smoke run caught a nonexistent storage accessor (`storage.trustElections` vs `workerTrustElections`) that the app typecheck can never see.
- `scripts/oneoffs/s1-t16-t19-smoke.ts` is the regression harness for all four loaders (fake staged rows against real dev entities; report + DB + idempotency + fail-closed assertions; self-cleaning).
