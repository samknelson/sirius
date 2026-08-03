# Strategy Revision — S1 Source Is MariaDB, Not Postgres

**Version 2 — 2026-08-03.** Supersedes v1 (2026-08-01) in full. Changes in v2: timezone conventions resolved (§5), charset findings added (§4.5), `smf_worker_month` structure resolved and reclassified (§4.2), dev environment now live (§7), N1 and N2 closed.

**Status:** supersedes assumptions in `README.md`, `01-field-inventory.md`, and all SQL in `04-entity-reassembly.md`.

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
| `smf_worker_month` | 2,532,136 | **See §4.2 — recommend DROP** |
| `sirius_log` | 1,782,747 | |
| `sirius_trust_worker_benefit` | 609,486 | |
| `sirius_trust_worker_election` | 243,328 | |
| `sirius_contact` | 131,660 | |
| `sirius_worker` | 117,679 | |
| `sirius_dispatch` | 51,497 | |
| `sirius_contact_relationship` | 35,774 | |
| `sirius_employer_payperiod` | 18,395 | **Unmapped** |
| `sirius_phonenumber` | 3,952 | |
| `sirius_feed` | 3,684 | |
| `sirius_payment` | 3,458 | See §4.6 |
| `grievance_shop_contact` | 557 | |
| `sirius_employee` | 539 | **Unmapped** — distinct from `sirius_worker` |
| `sirius_dispatch_job` | 318 | |
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
| `sirius_dispatch_facility` | 1 | |
| `sirius_callerid` | 1 | |
| `grievance_contract_template` | 1 | |
| `sirius_domain` | 1 | |

**Configured but empty — do not build ETL for these:**
`grievance` (89 fields), `sirius_edls_sheet` (14), `grievance_log` (12), `grievance_contract_clause` (10), `grievance_settlement` (9), `grievance_contract_rule` (7), `sirius_office_timeoff_request` (7), `sirius_trust_service` (7), `sirius_event` (7), `sirius_dispatch_job_group` (6), `sirius_event_participant` (6), `grievance_contract_section` (5), `sirius_emailaddress` (4), `sirius_dispatch_facility_hall` (4), `grievance_attachment` (4), `sirius_operator` (4), `sirius_bu` (3), `grievance_contract` (3), `sirius_document_retention_log` (3), `grievance_irset` (2).

### 4.2 `smf_worker_month` — RESOLVED, recommend DROP

2.53M nodes, absent from the entire original spec. Six fields:

| Field | Role |
|---|---|
| `field_sirius_worker` | Worker reference |
| `field_grievance_shop` | **Employer reference** — see §6 naming trap |
| `field_sirius_date_start` | Month anchor |
| `field_sirius_json` | Job-run metadata — structure below |
| `field_sirius_domain` | Domain scoping |
| `field_sirius_contact_tags` | Tags |

**`field_sirius_json` structure, confirmed uniform across all 2,474,945 rows** (100% valid JSON, exactly one top-level key, depth 5, ~73 bytes average, zero structural variation):

```json
{"smf": {"autotag": {"status": {"run_ts": <timestamp>, "asof_ts": <timestamp>}}}}
```

This is **automated job bookkeeping** — when a tagging process ran, and the as-of date it evaluated. It contains no hours, no benefit grants, and no eligibility outcome.

**Conclusion:** `smf_worker_month` is not S1's WMB record. It is a thin join record plus a last-processed marker. This **does not contradict** `04-entity-reassembly.md` row 7 or Q17 — S2's plan to regenerate `trust_wmb` from migrated elections + hours remains valid and uncontested.

**Recommendation: DROP.** 2.5M rows of cron metadata for a process that will not exist in S2. Pending confirmation from Sam that nothing downstream consumes it.

Note: 2,474,945 JSON rows against 2,532,136 nodes — roughly 57,000 records have no JSON row. Sparse field; the LEFT JOIN null path applies if this bundle is migrated after all.

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

---

## 5. Timezone conventions — RESOLVED

The timezone item in `05-open-questions.md` is closed. This section is **mandatory reading before writing any date transform.**

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
| N3 | `sirius_employer_payperiod` (18,395) — employer-side contribution reporting. Needs full mapping; relevant to LD/interest work | Mitchell |
| N4 | `sirius_employee` (539) vs `sirius_worker` (117,679) — staff records? | Sam |
| N5 | `sirius_trust_provider` (12) — carriers. Needs S2 target | Mitchell |
| N6 | Balance parity must reconcile `sirius_ledger_ar` (~547k) and `sirius_payment` (3,458) together. Affects Q20 test design | Laura / Sam |
| N7 | 16 configured-but-empty bundles — built and abandoned, or purged? Confirms they can be ignored | Sam |
| N8 | `sirius_twilio_conversation`, `grievance_company`, `grievance_chapter` — small unmapped bundles, need targets or explicit DROP | Mitchell |
| N9 | Does anything downstream consume `smf_worker_month`? If not, DROP per §4.2 | Sam |
| N10 | `ledger_memo` latin1 — is there pre-existing corruption in production? Needs a scan and a repair/carry-forward decision | Mitchell / Laura |

**Closed:** Q0, Q25, Q32, N1 (`field_sirius_json` structure), N2 (`smf_worker_month` vs regeneration plan), timezone convention.

**Confirmed as real risks:** Q36 (SSN uniqueness). Q21/Q16/Q17 should be re-checked against the real table list — those fields may exist and were simply absent from the sample.

**Not answerable from the database** — these need a walkthrough of S1 screens with someone who knows the system, not more queries: Q2 (`id2`/`id3`), Q3 (availdate semantics), Q5 (EBA), Q6 (`asi`), Q8 (`aat`), Q15 (`sirius_id` per bundle), Q23 (`cbn`), Q4 (HFE scope).

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

---

## 10. What to do first

1. Read `columns.tsv`. Regenerate `01-field-inventory.md` from it. Discard the old type column entirely.
2. Rewrite every SQL fragment in `04-entity-reassembly.md` for MySQL dialect.
3. Add the §5 timezone table to `03-transformations.md` as a mandatory per-field rule.
4. Remove grievance from ETL scope (§4.3).
5. Remove the 16 empty bundles from ETL scope (§4.1).
6. Add mapping sections for `sirius_employer_payperiod`, `sirius_trust_provider`, `sirius_employee`. Mark `smf_worker_month` as DROP pending N9.
7. Flag anything in `02-mapping.md` marked *(inferred)* that depended on sample values rather than structure — those inferences came from 10 rows and need re-derivation.

Do not write ETL code that connects to production. The reader module takes its DSN from `S1_DATABASE_URL`; the production DSN is supplied only inside the HIPAA-scope deployment.
