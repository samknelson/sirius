# S1 → S2 Mapping Table

One row per S1 field (and per `sirius_*` / core-table column group), grouped by the S1 bundle it serves. Destination is a concrete S2 `table.column` wherever one exists. Classes: **direct**, **NEEDS-TRANSFORM (T#)** (transform spelled out in [03-transformations.md](03-transformations.md)), **AMBIGUOUS-SOURCE (Q#/N#)** / **masked (Q#)** (see [05-open-questions.md](05-open-questions.md)), **NO-S2-EQUIVALENT**, **DROP**.

> **Revised per [06-strategy-revision.md](06-strategy-revision.md):** the source is MariaDB 10.6.25; column types now come from `profile/columns.tsv` (see regenerated [01-field-inventory.md](01-field-inventory.md)), and the bundle census is definitive. Destination decisions below mostly survive; the grievance section is descoped (§9a) and four previously-invisible bundles are added (§5d, §13).

⚠ Every mapping marked *(inferred)* is deduced from anonymized values/bundle context, not certain — confirm each against the live un-anonymized system.

## ⚠ Sample-derived inferences requiring re-derivation (06 §9.6)

The following *(inferred)* entries were derived from **values in the retired 10-row sample**, not from structure. Each must be re-derived from real aggregates (inside the HIPAA boundary) or from someone who knows the live system, before ETL uses it:

| Where | Inference at risk | Why suspect |
|---|---|---|
| §1 `field_sirius_id2`/`_id3` → `worker_ids` | "external worker ID" guessed from masked hex samples | masked values; production fill is 33,615 / 78,887 — real values never seen |
| §1 `field_sirius_dispatch_availdate` → `seniority_date` | role guessed from 10 sample datetimes that equaled the HFE values (suspicious default) | production has only 115 rows — sample was not representative |
| §1 `field_sirius_skill_expire` → `worker_certifications.end_date` | "skill/cert expiry" from sample datetimes | 115 rows in production; which skill it expires is unknown |
| §4/§8a `field_sirius_count` / `_count_yes` | "requested workers / yes-responses" from sample integers | counts of *what* never confirmed |
| §7 `field_sirius_datetime`/`_datetime_completed` → DROP | "processing timestamps, audit only" from sample values | if they encode period submission/completion, they may matter for N3 pairing |
| §7 `field_sirius_active` include/exclude, `payperiod_type` "totals" | derived from 10 rows | `payperiod_type` has **1 row** in all of production — the "totals" reading was sample noise |
| §8a `field_sirius_address_notes` → `dispatch_jobs.description` "direct" | content style guessed from one sample row | 1 row in sample; verify content class before mapping to a user-visible column |
| §9f `grievance_types` → `options_grievance_complaints` | term-name reading of masked sample terms | all term names masked; vocab may not survive descoping anyway |
| §9f `grievance_alert_types.actor` → `options_grievance_steps.actor` | from sample value "Union" | grievance descoped; only relevant if vocab is reused |
| §11 `sirius_json_definition` → `ws_bundles` *(inferred)* | purpose guessed from bundle name + 10 rows | 144 nodes in production — needs a real look at `field_sirius_json` payloads |
| §12 `flag` → `bookmarks` | flag-type names were masked | flag semantics never observed |
| 03-T8/T9/T13/T20 assumptions flagged in their own doc | sample-value-derived (identical-datetime default, degenerate bbox equality, monthly period grain) | re-verify each against production aggregates |

---

## 1. Workers — bundle `node/sirius_worker` → `workers` (+ `contacts`, satellites)

S1 keeps person data on a separate `sirius_contact` node referenced by the worker — the same worker/contact split S2 uses (`workers.contact_id → contacts.id`). Worker identity key: `workers.sirius_id` ← S1 `nid`. **Note:** `workers.sirius_id` is a `serial`; importing explicit S1 nids requires sequence handling → T1.

**Production census update (06):** the worker bundle also carries `field_sirius_name` (117,679), `field_sirius_email` (17,009), `field_sirius_phone` (36,319), `field_sirius_phone_alt` (752), `field_sirius_address` (51,962), `field_sirius_id` (117,679 — every worker), `field_sirius_json` (116,605), `field_sirius_industry` (**multi**, max delta 3; 68,836) and `field_grievance_shop` (7,489) — none of which were visible in the sample. Contact-style fields directly on workers must be reconciled with the contact-node mapping (which record wins when both exist?) — **new question N10**. Also note: current-state `field_sirius_work_status` has only **167** live rows (vs 68,673 member_status) — worker status history evidently lives elsewhere (revisions, or member_status carries the real state).

| S1 field | Value col | S2 destination | Class |
|---|---|---|---|
| `node.nid` (sirius_worker) | — | `workers.sirius_id` | NEEDS-TRANSFORM T1 (serial + explicit values) |
| `field_sirius_contact` | `_target_id` → sirius_contact nid | `workers.contact_id` (via contact nid→id map) | NEEDS-TRANSFORM T2 (nid remap) |
| `field_sirius_ssn` | `_value` (`XXX-XX-…` masked) | `workers.ssn` | NEEDS-TRANSFORM T3 (normalize format; unique) |
| `field_sirius_dob` | `_value` date | `contacts.birth_date` (worker's contact) | direct (date cast) |
| `field_sirius_gender` | `_tid` → vocab `sirius_gender` | `contacts.gender` → `options_gender.id` | NEEDS-TRANSFORM T4 (term remap) |
| `field_sirius_gender_nota_val` | `_value` MASKED | `contacts.gender_nota` | masked, confirm (Q1) |
| `field_sirius_gender_nota_calc` | `_value` "Male/Female" | `contacts.gender_calc` | direct |
| `field_sirius_phone_mobile` | `_value` 10-digit | `contact_phone` row (`phone_number`, `is_primary=true`) via worker's contact | NEEDS-TRANSFORM T5 |
| `field_sirius_id2` | `_value` masked hex | `worker_ids` row *(inferred: an external worker ID; type unknown)* | AMBIGUOUS-SOURCE Q2 |
| `field_sirius_id3` | `_value` masked hex | `worker_ids` row *(inferred)* | AMBIGUOUS-SOURCE Q2 |
| `field_sirius_work_status` | `_tid` → vocab `sirius_work_status` | `worker_wsh` (dated history row) + `options_worker_ws` | NEEDS-TRANSFORM T6 (scalar→history, revisions) |
| `field_sirius_member_status` | `_tid` → vocab `sirius_member_status` | `worker_msh` + `options_worker_ms` (has `sirius_id`) | NEEDS-TRANSFORM T6 |
| `field_sirius_worker_dispstatus` | `_tid` | `worker_dispatch_status.status` | NEEDS-TRANSFORM T7 (term→status code) |
| `field_sirius_dispatch_availdate` | `_value` datetime | `worker_dispatch_status.seniority_date` *(inferred: availability/seniority date)* | AMBIGUOUS-SOURCE Q3 |
| `field_sirius_dispatch_hfe_until` | `_value` datetime | `worker_dispatch_hfe.hold_until` (date) — **but S2 HFE is per-employer; S1 value is worker-global** | NEEDS-TRANSFORM T8 + Q4 |
| `field_sirius_dispatch_eba` | `_value` Yes/No | `worker_dispatch_eba` (per-ymd rows in S2 vs scalar flag in S1) | NEEDS-TRANSFORM T9 + Q5 |
| `field_sirius_dispatch_asi` | `_value` "Yes" | unknown role ("asi" not resolvable from sample) | AMBIGUOUS-SOURCE Q6 |
| `field_sirius_dispatch_medium` | `_value` "sms" | `workers.data.dispatchMedium` *(no first-class S2 column)* | NO-S2-EQUIVALENT (jsonb stash) |
| `field_sirius_skill_expire` | `_value` datetime | `worker_certifications.end_date` *(inferred: skill/cert expiry)* | AMBIGUOUS-SOURCE Q7 |
| `field_sirius_skills_availx` | `_value` "Yes" | unknown ("skills avail exception"?) | AMBIGUOUS-SOURCE Q7 |
| `field_sirius_aat` | `_value` int (365, 415499, 92464) | unknown; mixed magnitudes defeat inference | AMBIGUOUS-SOURCE Q8 |
| `field_sirius_aat_required` | `_value` "No" | unknown | AMBIGUOUS-SOURCE Q8 |
| `field_sirius_denorm_benefits` | `_target_id` multi | — (S1 denorm of current benefits; S2 recomputes `trust_wmb`/denorm) | DROP |
| `field_sirius_headshot` | `_fid` (+w/h) | `files` row (`entity_type='worker'`) via `file_managed` | NEEDS-TRANSFORM T10 (file transfer) |
| worker skills (taxonomy refs) | — | `worker_skills` / `options_skills` | AMBIGUOUS-SOURCE Q9 — **no worker→skills field table exists in production either**; skills, if any, live in `field_sirius_json` or nowhere |

## 2. Contacts — bundle `node/sirius_contact` → `contacts`, `contact_postal`, `contact_phone`

| S1 field | Value col(s) | S2 destination | Class |
|---|---|---|---|
| `field_sirius_name` | `_title/_given/_middle/_family/_generational/_credentials` | `contacts.title/given/middle/family/generational/credentials`; `display_name` computed | NEEDS-TRANSFORM T11 (display name) |
| `field_sirius_email` | `_value` | `contacts.email` (unique) + optional `comm_email_optin` seed | NEEDS-TRANSFORM T12 (dedupe) |
| `field_sirius_phone` | `_value` | `contact_phone` (`is_primary=true`) | NEEDS-TRANSFORM T5 |
| `field_sirius_phone_alt` | `_value` | `contact_phone` (`is_primary=false`, `friendly_name='Alt'`) | NEEDS-TRANSFORM T5 |
| `field_sirius_address` | `_thoroughfare/_premise/_locality/_administrative_area/_postal_code/_country` (+6 MASKED subcols) | `contact_postal.street/city/state/postal_code/country` | NEEDS-TRANSFORM T13 (compound merge) |
| `field_sirius_address_geo` | `_left/_top/_right/_bottom` (point; `_lat/_lon/_geom` MASKED) | `contact_postal.longitude` ← `_left`, `latitude` ← `_top` | NEEDS-TRANSFORM T13 |
| `field_sirius_address_accuracy` | `_value` "ROOFTOP" | `contact_postal.accuracy` | direct |
| `field_sirius_address_canon` | `_value` REDACTED | `contact_postal` (input to `createOrMatchAddress` canonicalization) | NEEDS-TRANSFORM T13 |
| `field_sirius_address_county` | `_value` | `contact_postal.validation_response.county` (no column) | NO-S2-EQUIVALENT (jsonb stash) |
| `field_sirius_lang` | `_value` en/es (multi) | preferred language — no S2 column | NO-S2-EQUIVALENT + Q10 |
| `field_sirius_contact_tags` | `_tid` multi (vocab `sirius_contact_tags`?) | closest S2: `options_comm_tags` (per-comm, not per-contact) | AMBIGUOUS-SOURCE Q11 |
| `field_sirius_source` | `_value` MASKED | provenance of the contact record | masked, confirm Q1 |

## 3. Phone-number registry — bundle `node/sirius_phonenumber` → `comm_sms_optin`

| S1 field | S2 destination | Class |
|---|---|---|
| `field_sirius_id` (3,952 rows — every node; likely the number itself) or node title | `comm_sms_optin.phone_number` | AMBIGUOUS-SOURCE Q12 (confirm which carries the E.164/bare number) |
| `field_sirius_sms_possible` (`Yes`) | `comm_sms_optin.sms_possible` | NEEDS-TRANSFORM T14 (Yes/No→bool) |
| `field_sirius_voice_possible` (`Yes`) | `comm_sms_optin.voice_possible` | NEEDS-TRANSFORM T14 |
| `field_sirius_json` (3,952 rows) | validation payload? inspect structure | AMBIGUOUS-SOURCE Q12 |

**Trap (06 §5):** production also has a **misspelled bundle `sirius_phonenubmer`** with 7 nodes and no populated field tables. Migrate them via node title if they hold real numbers, or skip with a logged reason — never silently.

## 4. Relationships — bundle `node/sirius_contact_relationship` → `worker_relations`

| S1 field | S2 destination | Class |
|---|---|---|
| `field_sirius_contact` (`_target_id`, 35,774 rows — **the owning side; Q13 CLOSED structurally**) | `worker_relations.worker_1` (via contact→worker resolution) | NEEDS-TRANSFORM T15 |
| `field_sirius_contact_alt` (`_target_id`) | `worker_relations.worker_2` (via contact→worker resolution) | NEEDS-TRANSFORM T15 |
| `field_sirius_contact_reltype` (`_tid`, vocab `sirius_contact_relationship_types`) | `worker_relations.relation_type` → `options_worker_relation_type.id` (has `sirius_id`) | NEEDS-TRANSFORM T4 |
| `field_sirius_count` (int, also on dispatch_job) | unknown (count of what, on a relationship?) | AMBIGUOUS-SOURCE Q14 ⚠ sample-derived |
| `field_sirius_date_start` (35,659) / `field_sirius_date_end` (132) | `worker_relations.start_ymd/end_ymd` | direct (date cast) — fields exist in production |
| `field_sirius_active` | active flag → end-dating convention | NEEDS-TRANSFORM T14 |

## 5. Trust/benefits

### 5a. Benefit catalogue — bundle `node/sirius_trust_benefit` → `trust_benefits`

| S1 field | S2 destination | Class |
|---|---|---|
| `node.nid` | `trust_benefits.sirius_id` | direct |
| `node.title` (masked) | `trust_benefits.name` | direct (live values) |
| `field_sirius_trust_benefit_type` (`_tid`) | `trust_benefits.benefit_type` → `options_trust_benefit_type.id` (has `sirius_id`) | NEEDS-TRANSFORM T4 |
| `field_sirius_id` (masked hash, on this bundle) | external benefit code → `trust_benefits.data`? | AMBIGUOUS-SOURCE Q15 |

### 5b. Elections — bundle `node/sirius_trust_worker_election` → `worker_trust_elections`

| S1 field | S2 destination | Class |
|---|---|---|
| `field_sirius_trust_benefits` (`_target_id`, multi delta≤3) | `worker_trust_elections.benefit_ids` (array of S2 benefit ids) | NEEDS-TRANSFORM T16 |
| `field_sirius_trust_policy` (`_target_id`) | **not stored** — S2 derives election policy (`resolveEmployerPolicyAsOf`); keep S1 value in `data.s1PolicyNid` for audit | NEEDS-TRANSFORM T16 |
| `field_sirius_contact_relations` (`_target_id`, multi) | `worker_trust_elections.relationship_ids` (via relationship nid→`worker_relations.id`) | NEEDS-TRANSFORM T16 |
| `field_sirius_trust_election_type` (`_tid` — only 62,032 of 243,328 elections carry it) | `worker_trust_elections.enrollment_type` (coded remap; decide default for the ~181k without a type) | NEEDS-TRANSFORM T16 |
| `field_sirius_worker` (243,325) | `worker_trust_elections.worker_id` | NEEDS-TRANSFORM T2 — **Q16 structurally closed**: field exists in production |
| `field_grievance_shop` (243,325 — employer ref, naming trap 06 §5) | `worker_trust_elections.employer_id` | NEEDS-TRANSFORM T2 |
| `field_sirius_date_start` (243,325) / `field_sirius_date_end` (171,308) | `worker_trust_elections.start_ymd/end_ymd` (open-ended elections have no end) | direct (date cast) |
| `field_sirius_active` | reconcile with end-date convention | NEEDS-TRANSFORM T14 |
| `field_sirius_attachments` (3 rows) | `files` | NEEDS-TRANSFORM T10 (trivial volume) |

### 5c. Worker-benefit grants — bundle `node/sirius_trust_worker_benefit` → coverage (target pending N1/N2)

| S1 field | S2 destination | Class |
|---|---|---|
| `field_sirius_trust_benefit` (`_target_id`) | `trust_wmb.benefit_id` | NEEDS-TRANSFORM T17 |
| `field_sirius_trust_subscriber` (`_target_id` → worker nid) | `trust_wmb.worker_id` (subscriber) | NEEDS-TRANSFORM T17 |
| `field_sirius_contact_relation` (`_target_id`) | covered dependent (S2 models coverage through election `relationship_ids`) | NEEDS-TRANSFORM T17 + Q17 |
| `field_sirius_trust_election` (`_target_id`, 517,841 of 609,486 — some grants have no election link) | link to owning election (`worker_trust_elections` via nid map) | NEEDS-TRANSFORM T17 |
| `field_sirius_date_start` (609,448) / `field_sirius_date_end` (442,235) | grant validity window — **Q17 partially closed**: date fields exist in production | direct (date cast) |
| `field_sirius_worker` (609,480) / `field_grievance_shop` (572,505 — employer) | `trust_wmb.worker_id` / `employer_id` inputs | NEEDS-TRANSFORM T17 |
| `field_sirius_notes` (609,349) / `field_sirius_json` (253,926) | contents unknown — inspect structure (aggregates only) | AMBIGUOUS-SOURCE Q17 |
| `field_sirius_active` | active flag | NEEDS-TRANSFORM T14 |

### 5d. Worker coverage months — bundle `node/smf_worker_month` → **UNMAPPED (N1/N2, blocking)**

**2,532,136 nodes — S1's second-largest bundle, absent from the sample and from every prior version of this spec** (06 §4.2). Fields (from `fielddata_stats.tsv`):

| S1 field | Rows | Reading | Class |
|---|---|---|---|
| `field_sirius_worker` (`_target_id`) | 2,532,136 | worker reference | NEEDS-TRANSFORM T2 (once targeted) |
| `field_grievance_shop` (`_target_id`) | 1,531,760 | **employer** reference (module-namespace trap, 06 §5) | NEEDS-TRANSFORM T2 |
| `field_sirius_date_start` | 2,532,136 | coverage month anchor | direct (date cast) |
| `field_sirius_json` | 2,474,169 | **payload — structure unknown; blocking N1** | AMBIGUOUS-SOURCE N1 |
| `field_sirius_domain` | 2,532,136 | domain scoping | DROP (single-tenant S2) |
| `field_sirius_contact_tags` | **13,569,799 field rows** (multi, max delta 17 — S1's largest single field table) | tags | AMBIGUOUS-SOURCE N1 |

If this is S1's per-month coverage record (name maps onto S2's `trust_wmb`), migrating it **supersedes the plan to regenerate `trust_wmb` from elections+hours** (old Q17 / T17-b): regeneration may produce different grants than S1 actually issued, and members were covered based on S1's answer — retroactively revoking a granted month creates a COBRA event. Policy decision N2 (Kristin), structure question N1 (Mitchell/Sam). **Do not build T17's regeneration step until N1/N2 are answered.**

### 5e. `sirius_trust_wb_scan_changelog` (app table)

Scan/audit log of S1's benefit scanner (start/ok actions, worker nids, benefit nids, `wb_nid`/`relationship_nid`/`msg` MASKED). S2 has its own scan machinery (`trust_wmb_scan_*`, `trust_wmb_events`) and regenerates it. → **DROP** (optionally archive raw). Flag: `mode='live'` rows dated 2026 imply the scanner still runs — coordinate cutover (Q18).

## 6. Ledger

### 6a. Accounts — bundle `node/sirius_ledger_account` → `ledger_accounts`

| S1 field | S2 destination | Class |
|---|---|---|
| `node.title` / `field_sirius_name_short` | `ledger_accounts.name` | direct |
| `field_sirius_currency` ("USD") | `ledger_accounts.currency_code` | direct |
| `field_sirius_id` (masked) | account code → `ledger_accounts.data` | AMBIGUOUS-SOURCE Q15 |

### 6b. Charges — `sirius_ledger_ar` → `ledger` (+ `ledger_ea`)

| S1 column | S2 destination | Class |
|---|---|---|
| `ledger_id` | idempotency key → `ledger.data.s1LedgerId` | direct |
| `ledger_amount` (numeric, signed) | `ledger.amount` | direct |
| `ledger_account` (nid) | `ledger_ea.account_id` (via account map) | NEEDS-TRANSFORM T18 |
| `ledger_participant` (nid: worker/contact) | `ledger_ea.entity_type/entity_id` → `ledger.ea_id` | NEEDS-TRANSFORM T18 |
| `ledger_reference` (nid) | `ledger.reference_type/reference_id` (resolve nid → migrated entity) | NEEDS-TRANSFORM T18 |
| `ledger_ts` (unix, incl. pre-2001 values) | `ledger.date` (+ `statement_ymd`) | NEEDS-TRANSFORM T18 |
| `ledger_status` ("Cleared") | no S2 ledger status column — import Cleared only? | AMBIGUOUS-SOURCE Q19 |
| `ledger_memo`, `ledger_json` | MASKED | `ledger.memo`/`ledger.data` — masked, confirm Q1 |
| `ledger_key` (mixed "test"/ids) | dedupe/idempotency key | AMBIGUOUS-SOURCE Q19 |

### 6c. Payments — bundle `node/sirius_payment` → `ledger_payments`

| S1 field | S2 destination | Class |
|---|---|---|
| `field_sirius_dollar_amt` (negative values) | `ledger_payments.amount` (sign convention differs → normalize) | NEEDS-TRANSFORM T19 |
| `field_sirius_payment_status` (Cleared/Failed) | `ledger_payments.status` (coded remap) | NEEDS-TRANSFORM T19 |
| `field_sirius_payment_type` (`_tid`) | `ledger_payments.payment_type` → `options_ledger_payment_type.id` | NEEDS-TRANSFORM T4 |
| `field_sirius_datetime_created` | `ledger_payments.date_created` | direct |
| `field_sirius_check_number` | `ledger_payments.details.checkNumber` | direct (jsonb) |
| `field_sirius_merchant_name` | `ledger_payments.details.merchantName` | direct (jsonb) |
| `field_sirius_ledger_account` (`_target_id`) | `ledger_ea.account_id` chain → `ledger_payments.ledger_ea_id` | NEEDS-TRANSFORM T19 |
| `field_sirius_payer` (`_target_id`) | `ledger_ea.entity_type/entity_id` | NEEDS-TRANSFORM T19 |
| `field_sirius_ledger_allocated` (Yes/No) | `ledger_payments.allocated` | NEEDS-TRANSFORM T14 (+ allocation replay decision Q20) |

### 6d. `sirius_ledger_balance` → **DROP** (derived balance cache; S2 computes balances from `ledger`). `balance_amount` is MASKED anyway.
### 6e. `sirius_quickhash` → **DROP** (generic hash/cache utility table; `hash_json` MASKED).

## 7. Hours — bundle `node/sirius_payperiod` → `worker_hours`

| S1 field | S2 destination | Class |
|---|---|---|
| `field_sirius_worker` (`_target_id`) | `worker_hours.worker_id` | NEEDS-TRANSFORM T20 |
| `field_grievance_shop` (`_target_id` → grievance_shop nid; reused on this bundle) | `worker_hours.employer_id` | NEEDS-TRANSFORM T20 |
| `field_sirius_date_start`/`_date_end` | `worker_hours.year/month/day` (period → Y/M/D convention) | NEEDS-TRANSFORM T20 |
| `field_sirius_datetime` / `_datetime_completed` (2,936,075 each — ~680k payperiods lack them) | processing timestamps → not stored (audit only) | DROP *(inferred)* ⚠ sample-derived — re-verify |
| `field_sirius_active` (3,617,328 — every row) | include/exclude filter *(inferred)* | AMBIGUOUS-SOURCE Q21 ⚠ sample-derived |
| `field_sirius_payperiod_type` | **1 row in all of production** — the sample's "totals" reading was noise | DROP (log the 1 row) |
| `field_sirius_json` (3,613,866 — near-universal) | **most likely home of the hours amount / employment status payload** — no other value-bearing field table exists for this bundle | AMBIGUOUS-SOURCE Q21→N9 (structure inspection, aggregates only) |
| `field_sirius_notes` | 1 row in production | DROP (log it) |

## 8. Dispatch

### 8a. Jobs — bundle `node/sirius_dispatch_job` → `dispatch_jobs`

| S1 field | S2 destination | Class |
|---|---|---|
| `node.title` | `dispatch_jobs.title` | direct |
| `field_sirius_dispatch_job_status` (Pending/Filled/Archived) | `dispatch_jobs.status` (+ `running`) | NEEDS-TRANSFORM T21 |
| `field_sirius_dispatch_job_type` (`_tid`) | `dispatch_jobs.job_type_id` → `options_dispatch_job_type.id` | NEEDS-TRANSFORM T4 |
| `field_grievance_shop` (employer ref, shared field) | `dispatch_jobs.employer_id` | NEEDS-TRANSFORM T2 |
| `field_sirius_datetime` | `dispatch_jobs.start_ymd` | direct (date cast) |
| `field_sirius_count` | `dispatch_jobs.worker_count` *(inferred: requested workers)* | AMBIGUOUS-SOURCE Q14 |
| `field_sirius_count_yes` | responses count → `dispatch_jobs.data` *(inferred)* | AMBIGUOUS-SOURCE Q14 |
| `field_sirius_emails` (multi, delta≤9) | notification recipients → `dispatch_jobs.data.notifyEmails` | NO-S2-EQUIVALENT (jsonb stash) |
| `field_sirius_dispatch_facility` (`_target_id`) | `dispatch_jobs`… S2 keeps facility on `edls_sheets.facility_id`; for jobs → `dispatch_jobs.data.facilityId` → `facilities` (has `sirius_id`) | NEEDS-TRANSFORM T21 |
| `field_sirius_dispatch_job_group` (`_target_id`) | `dispatch_job_group` (has `sirius_id`) link → `dispatch_jobs.data.jobGroupId` | NEEDS-TRANSFORM T21 |
| `field_sirius_dispatch_job_nfcns` ("job_fill") | notification config → `dispatch_jobs.data` | NO-S2-EQUIVALENT |
| `field_sirius_notify` (Yes/No) | `dispatch_jobs.data.notify` | NO-S2-EQUIVALENT |
| `field_sirius_dispatch_eba`/`_eba_dates` (on job) | job-level EBA requirement → `dispatch_jobs.data` | AMBIGUOUS-SOURCE Q5 |
| `field_sirius_address_notes` | site notes → `dispatch_jobs.description` | direct *(inferred)* |
| `field_sirius_pay rate` — see dispatches below | `dispatch_jobs.pay_rate` | masked Q1 |

### 8b. Dispatches — bundle `node/sirius_dispatch` → `dispatches`

| S1 field | S2 destination | Class |
|---|---|---|
| `field_sirius_dispatch_job` (`_target_id`) | `dispatches.job_id` | NEEDS-TRANSFORM T2 |
| `field_sirius_worker` (51,538 — **Q22 CLOSED**: field exists in production) | `dispatches.worker_id` | NEEDS-TRANSFORM T2 |
| `field_sirius_dispatch_status` (terminated/accepted/accepted_secondary) | `dispatches.status` remap | NEEDS-TRANSFORM T22 |
| `field_sirius_dispatch_type` (Primary/Secondary) | folded into status or `dispatches.data.type` | NEEDS-TRANSFORM T22 |
| `field_sirius_date_start` (51,533) / `field_sirius_date_end` (7,114) | `dispatches` start/end dates — fields exist in production | direct (date cast) |
| `field_sirius_payrate` (22,191; values MASKED in sample) | `dispatch_jobs.pay_rate` / `dispatches.data.payRate` | masked, confirm Q1 |
| `field_sirius_aat` (51,538 — also on workers) | unknown (same Q8 acronym) | AMBIGUOUS-SOURCE Q8 |
| `field_sirius_dispatch_cbn` ("No") | unknown ("call-by-name"? *(inferred)*) | AMBIGUOUS-SOURCE Q23 ⚠ sample-derived |

### 8c. Dispatch-adjacent vocabularies
- `sirius_dispatch_job_type` terms (+`field_sirius_name_display`) → `options_dispatch_job_type` (T4).
- `sirius_dispatch_sib` terms (+`field_sirius_dispatch_available`) → dispatch eligibility config (S2 `plugin_configs_dispatch` / eligibility plugins) — AMBIGUOUS-SOURCE Q24 ("SIB" role unconfirmed).
- `field_sirius_dispatch_available` on `sirius_work_status` terms → eligibility flag consumed by S2 dispatch eligibility plugins → `options_worker_ws.data.dispatchAvailable` (T4).

## 9. Grievances

### 9a. Bundle `node/grievance` → **DESCOPED (Q25 closed, 06 §4.3)**
Production has the full grievance table set (290 tables: 145 `field_data_*` + 145 `field_revision_*`) and **zero grievance nodes** — 89 fields configured, never used. There is nothing to migrate and nothing to reconstruct from revisions. **Grievance is a greenfield S2 build, not an ETL target.** The S2 grievance model (`grievances`, `grievance_workers`, `grievance_status_history`, …, with S1-aware nid handling) stays as-is for future native use. Note the `field_grievance_*` namespace still matters to ETL: many of those tables serve *other* bundles (`grievance_shop`, `grievance_shop_contact`, `smf_worker_month`, taxonomy terms) — see §9b-c and §5d.

### 9b. Shops — bundle `node/grievance_shop` → `employers`

| S1 field | S2 destination | Class |
|---|---|---|
| `node.title` | `employers.name` | direct |
| `node.nid` | `employers.sirius_id` | direct |
| `field_grievance_external_id` ("0153", "H0460") | employer external code → `employers.data`/`companies.sirius_id` | AMBIGUOUS-SOURCE Q26 |
| `field_sirius_industry` (`_tid`) | `employers.industry_id` → `options_industries` (has `sirius_id`) | NEEDS-TRANSFORM T4 |
| `field_sirius_dispatch_job_types` (`_tid`) | employer-allowed job types → `plugin_configs_dispatch`/`employers.data` | AMBIGUOUS-SOURCE Q24 |
| `field_grievance_contract` (`_fid`) | contract PDF → `files` + S2 `contracts` (via `scripts/migrate/core/import-contracts-from-pdf.ts`) | NEEDS-TRANSFORM T10/T23 |
| `field_grievance_attachments` (`_fid` multi) | `files` rows (`entity_type='employer'`) | NEEDS-TRANSFORM T10 |
| `field_grievance_tags` (`_tid`) | employer tags — no S2 home | NO-S2-EQUIVALENT |
| `field_sirius_name_tts` | text-to-speech name → `employers.data.ttsName` | NO-S2-EQUIVALENT (jsonb stash) |

### 9c. Shop contacts — bundle `node/grievance_shop_contact` → `contacts` + `employer_contacts` + `contact_postal`/`contact_phone`

| S1 field | S2 destination | Class |
|---|---|---|
| `field_grievance_co_name` | `contacts.display_name` (split given/family unavailable) | NEEDS-TRANSFORM T24 |
| `field_grievance_co_role` | `employer_contacts.contact_type_id` → `options_employer_contact_type` (free text → coded) | NEEDS-TRANSFORM T24 |
| `field_grievance_co_email` (`_email`) | `contacts.email` | direct |
| `field_grievance_co_phone`/`_phone_2`/`_fax` | `contact_phone` rows (friendly_name Phone/Phone 2/Fax) | NEEDS-TRANSFORM T5 |
| `field_grievance_co_address`/`_address_2`/`_city`/`_state`/`_zip` | `contact_postal.street(+line2)/city/state/postal_code` | NEEDS-TRANSFORM T13 |
| `field_grievance_shops` (`_target_id`, employer) | `employer_contacts.employer_id` | NEEDS-TRANSFORM T2 |
| `field_grievance_company` (`_target_id`) | `companies` (has `sirius_id`) + `employer_companies` | NEEDS-TRANSFORM T2 |
| `field_grievance_contact_types` (`_tid`, multi) | `employer_contacts.contact_type_id` (S2 allows one per link row → one row per type) | NEEDS-TRANSFORM T24 |
| `field_grievance_description` | MASKED | masked, confirm Q1 |

### 9d. Letter templates — bundle `node/grievance_letter_template`
`field_grievance_notify_subject/_notify_body/_shortname/_roles/_update_rep/_mustlog/_rawhtml`, `field_sirius_letter_content_type`. S2 has no letter-template entity (closest: event-notifier configs / `comm_postal.template_id`). → **NO-S2-EQUIVALENT** — decide: rebuild as S2 notification templates manually; do not machine-migrate. Body MASKED (Q1).

### 9e. Config/CMS bundles → DROP
- `grievance_field_overrides` (`field_grievance_bundle/_field_name/_label/_entity_type/_description`): D7 per-field UI overrides → **DROP** (S2 equivalents are code/plugin config).
- `grievance_basic_page`, `page`, `sirius_help` (+`field_sirius_paths/_public`, `body`): CMS/help pages → **DROP** (rebuild help in S2 if wanted).
- `grievance_contract_template` (`field_grievance_comments`): → **DROP** *(inferred: authoring scaffold)*.
- `grievance_holiday` (`field_grievance_date`, `field_grievance_annual`): business-day holiday calendar feeding grievance deadlines → **NO-S2-EQUIVALENT**; S2 timeline steps support `day_type` — holidays likely belong in a `variables` entry or timeline plugin config (Q27).

### 9f. Grievance vocabularies → `options_grievance_*` (all have `sirius_id`)
| Vocab | S2 destination | Extra term fields |
|---|---|---|
| `grievance_status` | `options_grievance_status` | `field_grievance_open` → `options_grievance_status.open` (T14) |
| `grievance_types` | `options_grievance_complaints` *(inferred: "type of complaint")* — Q28 | — |
| `grievance_remedies` | `options_grievance_remedies` | hierarchy (`taxonomy_term_hierarchy` parents) → flatten, keep parent name in `data` (T4) |
| `grievance_log_types` | grievance step/log config; `field_grievance_timeline_show` → step visibility | AMBIGUOUS Q28 |
| `grievance_category` / `grievance_broughtby` | `options_grievance_category` / no equivalent | Q28 |
| `grievance_document_types` (+`can_attach`/`can_ir`/`content_types`) | files `access_level`/allowed-type config | NO-S2-EQUIVALENT Q28 |
| `grievance_alert_types` (+`field_grievance_actor` "Union") | `options_grievance_steps.actor` *(inferred)* | Q28 |
| `grievance_contract_section_tags` (+`field_sirius_css_class`) | contract section tagging → `contract_sections.data` | NO-S2-EQUIVALENT |

## 10. Comms & bulk messaging

| S1 source | S2 destination | Class |
|---|---|---|
| `node/sirius_bulk` (`field_sirius_bulk_medium` sms/email, `field_sirius_bulk_status` sent/draft, `field_sirius_sms`, `field_sirius_voice`, `field_grievance_notify_subject`) | `bulk_messages` + `bulk_messages_sms`/`bulk_messages_email` | NEEDS-TRANSFORM T25 |
| `node/sirius_log` with `field_sirius_type` in (incoming_sms, outgoing_sms) + `field_sirius_log_handler` (`_target_id`, multi) | `comm` + `comm_sms` (direction from type; contact via handler ref) | NEEDS-TRANSFORM T26 |
| `node/sirius_log` other types (popup, news:view, twilio:conversation, fastload) + `field_sirius_category/_message/_notes/_summary/_attachments/_json/_fastload_status/_domain` | activity/audit log → `winston_logs` (or archive-only) — message/notes/json MASKED | NEEDS-TRANSFORM T26 + Q29 |
| `node/sirius_news` (`field_sirius_roles` multi, `field_sirius_boolean`) | announcements — no S2 equivalent (closest `comm_inapp`) | NO-S2-EQUIVALENT Q30 |
| `node/sirius_phonenumber` | `comm_sms_optin` (see §3) | T14 |
| `node/sirius_callerid` (`field_sirius_name_display`) | telephony config → S2 comm plugin config | NO-S2-EQUIVALENT / DROP |
| `node/sirius_letterhead` (`field_sirius_letterhead_format` "pdf") | postal letterhead → `comm_postal` template config | NO-S2-EQUIVALENT / DROP |

## 11. System / platform bundles

| S1 source | S2 destination | Class |
|---|---|---|
| `node/sirius_domain` (+`field_sirius_tz`, `field_sirius_name_short`) | S1 multi-domain config — S2 is single-tenant per deployment | DROP (record tz in `variables` if needed) |
| `node/sirius_json_definition` (+`field_sirius_public`) | public JSON/API definitions → S2 `ws_bundles`/`ws_clients` *(inferred)* | AMBIGUOUS-SOURCE Q31 |
| `node/sirius_feed` (`field_sirius_feed_status` complete/draft) + `feeds_*` core tables | S1 import bookkeeping → S2 `wizards` history | DROP |
| `node/sirius_term_proxy` (`field_sirius_term_proxy/_term_source`) | taxonomy indirection layer | DROP (resolve through it during term remap, T4) |
| `node/member` bundle (1 node) | vestigial — **Q32 CLOSED (06 §4.1)** | DROP |

## 13. Newly-visible bundles needing mapping (06 §4.1) — previously absent from this spec

### 13a. `sirius_employer_payperiod` (18,395 nodes) → **UNMAPPED (N3)**
Employer-side contribution reporting. Fields (all 18,395 rows each): `field_grievance_shop` (employer ref), `field_sirius_active`, `field_sirius_datetime`, `field_sirius_datetime_completed`, `field_sirius_date_start`, `field_sirius_date_end`, `field_sirius_domain`. No hours/amount field table — the record looks like a per-employer reporting-period envelope (likely the parent of `sirius_payperiod` rows and/or the trigger for `sirius_ledger_ar` charges). Relevant to LD/interest work. Needs full mapping — owner: Mitchell (N3).

### 13b. `sirius_trust_provider` (12 nodes) → **UNMAPPED (N5)**
Carriers. Fields: `field_sirius_active`, `field_sirius_address` (+`_geo`), `field_sirius_json`, `field_sirius_domain`; names in `node.title`. S2 has no carrier entity — candidates: a small `options_*`-style table, or provider info in `trust_benefits.data`. Tiny volume; could also be hand-entered post-migration. Decide with N5.

### 13c. `sirius_employee` (539 nodes) → **UNMAPPED (N4)**
Distinct from `sirius_worker`. Fields: `field_sirius_worker` (ref), `field_grievance_shop` (employer ref), `field_sirius_id`, `field_sirius_domain`. Reads as a worker↔employer employment link (staff records? current-employment markers?). Confirm with N4 before mapping (candidate S2 homes: `worker_employers`-style link or `workers.data`).

### 13d. `sirius_twilio_conversation` (8), `grievance_company` (3), `grievance_chapter` (2) → **UNMAPPED (N8)**
No populated field tables beyond core — title-only or near-title-only nodes. `grievance_company` is referenced by `field_grievance_company` on shop contacts (§9c) → migrate as `companies` rows if those 3 nodes are the targets. The other two need explicit targets or a logged DROP decision (N8).

## 12. D7 core tables

| S1 table | S2 destination | Class |
|---|---|---|
| `node` | per-bundle entity keys: `nid`→`sirius_id`, `title`→name fields, `created`→`created_at`-style fields, `status`→`is_active` flags | NEEDS-TRANSFORM (per entity, see 04) |
| `node_revision` | revision spine for history carry-over decisions (see 04) | per-entity |
| `users`, `users_roles`, `role`, `authmap` | `users`, `auth_identities` (Okta), `roles`, `user_roles` | NEEDS-TRANSFORM T27 |
| `field_data_field_grievance_phone`/`_phone_off` (user profile) | staff phone → `users.data` | NO-S2-EQUIVALENT (jsonb stash) |
| `field_data_field_sirius_signature` (user, `_fid`) | staff signature image → `files` (`entity_type='user'`) | NEEDS-TRANSFORM T10 |
| `taxonomy_vocabulary`, `taxonomy_term_data`, `taxonomy_term_hierarchy` | `options_*` tables per vocab (see per-domain rows); `sirius_id` ← `tid` | NEEDS-TRANSFORM T4 |
| `taxonomy_index` | derived index | DROP |
| `file_managed`, `file_usage` | `files` + object-storage transfer (`private://` + `s3fs_file`) | NEEDS-TRANSFORM T10 |
| `variable` (names+values masked; sample shows Twilio-like SIDs, phone numbers) | S2 `variables` / secrets — **manual review only**, never bulk-copy (contains credentials) | masked, confirm Q33 |
| `flag`, `flagging`, `flag_counts` | `bookmarks` (user↦entity flags) *(inferred)* | NEEDS-TRANSFORM T28 + Q34 |
| `url_alias`, `menu_*`, `block*`, `views_*`, `ds_*`, `ckeditor_*`, `filter*`, `image_*`, `fontyourface_*`, `search_*`, `watchdog`, `sessions`, `history`, `queue`, `sequences`, `registry*`, `system`, `cache-like tables`, `backup_migrate_*`, `elysia_cron`, `l10n_*`, `locales_*`, `i18n_string`, `languages`, `rdf_mapping`, `shortcut_set`, `print_*`, `nodequeue_*`, `draggableviews_structure`, `conditional_fields`, `field_group`, `field_validation_rule`, `fieldset_helper_state_manager`, `custom_help_text_roles`, `environment_indicator_environment`, `date_format*`, `front_page`, `login_destination`, `name_custom_format`, `pathauto_state`, `actions`, `services_endpoint`, `features_signature` | D7 framework plumbing | DROP |
| `tfa_*` (TOTP seeds, recovery codes) | S2 auth is Okta — do not migrate secrets | DROP |
| `comment`, `node_comment_statistics` (3 grievance comments in sample) | grievance notes → `grievances.data`/status-history notes | AMBIGUOUS-SOURCE Q35 |
| `webform*` — **confirmed absent from production** (not in the 818-table census) | — | n/a |
