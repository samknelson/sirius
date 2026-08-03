# Entity Reassembly Plan

How S1's scattered `field_data_*` tables join back into whole logical records, per bundle, and how each reassembled record lands in S2's entity model. Includes the per-entity decision on `field_revision_*` history.

> **Dialect note (per [06-strategy-revision.md](06-strategy-revision.md)):** the S1 source is **MariaDB 10.6.25**. All SQL below is MySQL/MariaDB dialect. Postgres constructs (`::` casts, `to_timestamp`, `array_agg`, lateral subqueries, `pg_class`) do not exist on the source side. S2-side writes remain Postgres, routed through storage.

## The generic reassembly shape

Every D7 logical record is one `node` row plus N field-table rows joined on `entity_id = node.nid`:

```sql
SELECT n.nid, n.title, n.status, FROM_UNIXTIME(n.created) AS created,
       f1.field_a_value, f2.field_b_target_id
FROM node n
LEFT JOIN field_data_field_a f1
       ON f1.entity_type = 'node' AND f1.bundle = n.type
      AND f1.entity_id = n.nid AND f1.deleted = 0
      AND f1.language = 'und'
LEFT JOIN field_data_field_b f2 ON /* same predicate shape */
WHERE n.type = '<bundle>';
```

Rules:
- **Always `LEFT JOIN`** — absence of a field row is normal (sparse fields; production fill varies wildly, e.g. `field_sirius_phone_mobile` covers 25 of 117,679 workers).
- **`deleted = 0` — unquoted.** `deleted` is `tinyint(4)`, an integer. (`entity_type` and `bundle` are `varchar(128)` — those stay quoted.)
- **Always filter `entity_type = 'node'`** (or the relevant entity type). Production field tables carry `node`, `taxonomy_term`, `user` **and `comment`** rows in the same physical table — the filter is load-bearing.
- **Include `language = 'und'` in join predicates.** Profiling confirms `und` is the only value present anywhere (field translation never enabled), but the column is part of the PK; make the assumption explicit rather than silently relying on it. Do not assume this for future S1 data.
- **Multi-value fields (`max_delta > 0` in `profile/fielddata_stats.tsv`) are aggregated, not joined flat** — or you silently multiply rows. MariaDB options:

```sql
-- concatenated ids (fine for _target_id / _tid lists):
SELECT entity_id, GROUP_CONCAT(field_x_target_id ORDER BY delta) AS ids
FROM field_data_field_x
WHERE entity_type = 'node' AND bundle = '<b>' AND deleted = 0 AND language = 'und'
GROUP BY entity_id

-- or JSON when order+type fidelity matters (MariaDB 10.6 has JSON_ARRAYAGG,
-- and unlike MySQL it accepts ORDER BY inside the aggregate):
SELECT entity_id, JSON_ARRAYAGG(field_x_value ORDER BY delta) AS vals ...
```

  Multi-value fields confirmed in production (from `fielddata_stats.tsv`): `field_sirius_trust_benefits` (max delta 10), `field_sirius_contact_relations` (7), `field_sirius_contact_tags` (17 on smf_worker_month — 13.57M field rows; 26 on sirius_contact — 544k rows), `field_sirius_denorm_benefits` (12), `field_sirius_industry` (3), `field_sirius_emails` (9), `field_grievance_attachments` (5), `field_grievance_contact_types`, `field_grievance_images`, `field_grievance_roles`, `field_grievance_tags`, `field_sirius_roles`, `field_sirius_log_handler`, and others — always check the stats file, never assume single-valued.
- **Current vs revision:** `field_data_*` holds the current revision only (`revision_id = node.vid`). History lives in `field_revision_*` keyed by `revision_id` → `node_revision.vid`, with `node_revision.timestamp` as the change clock.
- **Timestamps:** `node.created` / `node.changed` / `node_revision.timestamp` are `int(11)` unix seconds → `FROM_UNIXTIME(...)`. The uniform-`changed` observation from the old sample was an anonymization artifact — **re-verify against production aggregates** before trusting `changed` either way.
- **`node.status = 0`** (unpublished) maps to the entity's inactive flag where one exists (`employers.is_active`, `trust_benefits.is_active`, …); entities without an active flag migrate with `data.s1Unpublished = true`.
- **nids run ~2.4M–22M.** Do not assume small integers; id maps must be sized for millions of entries.
- **Row-count validation** uses `information_schema.tables` estimates or `SELECT COUNT(*)` — never `pg_class.reltuples`.

## Per-bundle reassembly → S2 target

Bundle census is now definitive (40 populated bundles, 9.15M nodes — 06 §4.1). Bundles below are ordered by production node count.

| # | S1 bundle (nodes) | Field tables joined (on `entity_id = nid`) | S2 target(s) | Revision history |
|---|-----------|--------------------------------------------|--------------|------------------|
| 1 | `sirius_payperiod` (3,617,328) | worker(ref), shop(ref via field_grievance_shop), date_start/end, datetime, datetime_completed, active, domain, **json (3.61M rows — likely carries the hours payload, N9)**. `payperiod_type` and `notes` have 1 row each in production — the old "totals" inference came from sample noise | `worker_hours` via `upsertWorkerHours` | Drop (only current values migrate — S2's wizard re-imports handle future corrections). |
| 2 | `smf_worker_month` (2,532,136) | worker(ref), shop(**employer** ref via field_grievance_shop — naming trap, 06 §5), date_start, domain, **json (2.47M rows, structure unknown — N1)**, contact_tags (multi, max delta 17) | **Unmapped.** Name maps onto S2's WMB (monthly coverage) concept. If this is S1's per-month coverage record it supersedes the regenerate-from-elections plan (N2) — see row 4 and 02-mapping §5d. Also carries `field_sirius_contact_tags` (13.57M field rows, max delta 17) | **Blocked on N1/N2** — policy question: migrating actual granted months vs regenerating (regeneration risks retroactively revoking granted coverage → COBRA events). |
| 3 | `sirius_log` (1,782,747) | type, category, message, notes, summary, attachments(fid), json, log_handler(multi ref), fastload_status, domain(ref) | `comm`+`comm_sms` (sms types) / archive (rest) | Drop (logs are their own history). |
| 4 | `sirius_trust_worker_benefit` (609,486) | trust_benefit(ref), trust_election(ref), trust_subscriber(ref), contact_relation(ref), **worker(ref), shop(ref), date_start (609,448), date_end (442,235), active, notes (609,349), json (253,926)** — the date/employer fields the sample lacked exist in production | election coverage + `trust_wmb` decision pending N2 (transform T17) | **Drop** — S2 regenerates or imports monthly WMB per N2; S1's `sirius_trust_wb_scan_changelog` is the S1-side audit and also drops. |
| 5 | `sirius_trust_worker_election` (243,328) | trust_benefits(multi ref, max delta 10), trust_policy(ref), contact_relations(multi ref, max delta 7), trust_election_type(ref — only 62,032 rows, sparse), **worker(ref, 243,325), shop(ref, 243,325), date_start (243,325), date_end (171,308), active** — subscriber/employer/date fields exist in production (Q16 partially closed) | `worker_trust_elections` | **Drop revisions; migrate terminal states.** If production encodes supersession as separate election nodes (typical), each node migrates as its own dated election row — that *is* the history. |
| 6 | `sirius_contact` (131,660) | name, email, phone, phone_alt, address (+geo/accuracy/canon/county), lang, contact_tags (multi), source | `contacts` + `contact_postal` + `contact_phone` | **Drop**, except address history *option*: prior addresses from `field_revision_field_sirius_address` could seed additional non-primary `contact_postal` rows (`is_active=false`). Default: drop. |
| 7 | `sirius_worker` (117,679) | contact(ref), ssn (117,566), dob, gender(+nota), phone_mobile (25!), id (117,679), id2 (33,615), id3 (78,887), work_status (**167 rows only**), member_status (68,673, **multi max delta 3**), industry (**multi max delta 3**, 68,836), dispstatus (805), dispatch_* (availdate/hfe/eba/asi/medium), skills_availx, skill_expire (115), aat, aat_required, headshot (2), denorm_benefits (multi), **plus name/email/phone/address/json/shop directly on the worker bundle** — production attaches several "contact" fields to workers too | `workers` (+ satellites: `worker_ids`, `worker_dispatch_status`, `worker_dispatch_hfe`, `worker_dispatch_eba`, `worker_certifications`) | **Selective carry-over:** `field_revision_field_sirius_work_status` / `_member_status` + `node_revision.timestamp` become `worker_wsh` / `worker_msh` dated history rows (transform T6) — note current-state `work_status` has only 167 live rows; the history may live mostly in revisions or in member_status. All other worker field revisions drop. |
| 8 | `sirius_dispatch` (51,497) | dispatch_job(ref), **worker(ref, 51,538 — Q22 closed)**, dispatch_status, dispatch_type, payrate (22,191), cbn, **aat (51,538), date_start (51,533), date_end (7,114)** | `dispatches` | **Drop revisions; final status only**; `date_start`/`date_end` exist in production and populate S2's date columns directly. |
| 9 | `sirius_contact_relationship` (35,774) | **contact(ref, 35,774 — the owning side, Q13 closed)**, contact_alt(ref), contact_reltype(tid), count, active, **date_start (35,659), date_end (132)** | `worker_relations` | **Carry as dates, not revisions:** `date_start`/`date_end` populate `start_ymd`/`end_ymd`; revision rows drop. |
| 10 | `sirius_employer_payperiod` (18,395) | shop(ref), active, datetime, datetime_completed, date_start, date_end, domain — all 18,395 rows each; no hours/amount field table | **Unmapped (N3)** — employer-side contribution reporting; likely pairs with `sirius_payperiod` rows or `sirius_ledger_ar` charges | TBD with N3. |
| 11 | `sirius_phonenumber` (3,952) | sms_possible, voice_possible, **id (3,952 — likely the number itself, Q12), json (3,952)**, datetime (1 row) | `comm_sms_optin` | Drop. |
| 12 | `sirius_feed` (3,684) | feed_status | S1 import bookkeeping | DROP. |
| 13 | `sirius_payment` (3,458) | dollar_amt, payment_status, payment_type(tid), datetime_created, check_number, merchant_name, ledger_account(ref), payer(ref), ledger_allocated | `ledger_payments` (+ `ledger_ea`) | **Drop revisions** — payments are immutable facts. Count is low relative to ledger volume — see N6 (does financial activity live in `sirius_ledger_ar`?). |
| 14 | `grievance_shop_contact` (557) | co_name/role/email/phone/phone_2/fax/address/address_2/city/state/zip, shops(ref), company(ref), contact_types(tid multi), description | `contacts` + `employer_contacts` + `contact_postal`/`contact_phone` + `companies`/`employer_companies` | Drop. |
| 15 | `sirius_employee` (539) | worker(ref), shop(ref), id, domain | **Unmapped (N4)** — distinct from `sirius_worker`; likely staff/employer-employee records | TBD with N4. |
| 16 | `sirius_dispatch_job` (318) | job_status, job_type(tid), shop(ref), datetime, count, count_yes, emails(multi, max delta 9), facility(ref), job_group(ref), nfcns, notify, eba(+dates), address_notes | `dispatch_jobs` | Drop. |
| 17 | `grievance_shop` (254) | external_id, industry(tid), dispatch_job_types(tid), contract(fid), attachments(fid multi, max delta 5), tags(tid), name_tts | `employers` (+ `files`, `contracts`) | Drop. |
| 18 | `sirius_term_proxy` (254) | term_proxy/term_source | taxonomy indirection | DROP (resolve through it during term remap, T4). |
| 19 | `sirius_trust_benefit` (19) | trust_benefit_type(tid), sirius_id, body | `trust_benefits` | Drop. |
| 20 | `sirius_trust_provider` (12) | active, address(+geo), json, domain | **Unmapped (N5)** — carriers; candidate S2 home: options/config table or `trust_benefits.data` | TBD with N5. |
| 21 | `sirius_twilio_conversation` (8), `grievance_company` (3), `grievance_chapter` (2) | no populated field tables beyond core (title-only or near-title-only nodes) | **Unmapped (N8)** — need targets or explicit DROP | TBD with N8. |
| 22 | `sirius_phonenubmer` (7) | **misspelled bundle coexisting with `sirius_phonenumber`** — no populated field tables | handle with §3 or skip with a logged reason (06 §5) | — |
| 23 | `sirius_ledger_account` (3) | currency, name_short, sirius_id | `ledger_accounts` | Drop. |
| 24 | `sirius_bulk` (45) | bulk_medium, bulk_status, sms, voice, notify_subject, body | `bulk_messages` + medium subtables | Drop. |
| 25 | `grievance_letter_template` (9), `grievance_field_overrides` (6), `grievance_basic_page` (6), `grievance_contract_template` (1), `grievance_holiday` (2), `page` (3), `sirius_help` (164), `sirius_news` (5), `sirius_domain` (1), `sirius_callerid` (1), `sirius_letterhead` (1), `sirius_json_definition` (144) | (see 02-mapping §9d-e, §10-11) | NO-S2-EQUIVALENT / DROP per mapping | Drop. |
| 26 | `member` (1) | — | **DROP** (Q32 closed — vestigial) | — |
| 27 | `user/user` entity | grievance_phone, grievance_phone_off, grievance_shops(ref), sirius_signature(fid) + core `users` | `users`, `user_roles`, `auth_identities`, `files` | Drop. |
| 28 | `taxonomy_term/*` entities | per-vocab term fields (open, days, badge, css_class, name_short/display/alt, member_active, dispatch_available, content_types, can_attach/can_ir, term_source, event_proles, sirius fields) | `options_*` per 02-mapping §9f, §8c + others | Drop (terms have no meaningful revisions). |

### Removed from scope entirely (06 §4)

- **`grievance` bundle — 0 nodes in production** (89 fields configured, never used). The previous plan to reconstruct `grievance_status_history` from `field_revision_field_grievance_status` is void: **there is nothing to reconstruct.** Grievance is a greenfield S2 build, not a migration target.
- **The configured-but-empty bundles** (06 §4.1 names 20 — its "16" count doesn't match its own list; either way each has zero nodes): `grievance`, `sirius_edls_sheet`, `grievance_log`, `grievance_contract_clause`, `grievance_settlement`, `grievance_contract_rule`, `sirius_office_timeoff_request`, `sirius_trust_service`, `sirius_event`, `sirius_dispatch_job_group`, `sirius_event_participant`, `grievance_contract_section`, `sirius_emailaddress`, `sirius_dispatch_facility_hall`, `grievance_attachment`, `sirius_operator`, `sirius_bu`, `grievance_contract`, `sirius_document_retention_log`, `grievance_irset`. **Do not build ETL for these.** (N7 asks whether they were abandoned or purged — if purged, confirm nothing must be recovered from revisions.)

## Cross-bundle join spine (who references whom)

```
sirius_worker ──field_sirius_contact──────────► sirius_contact
sirius_worker ◄──field_sirius_worker─────────── sirius_payperiod ──field_grievance_shop──► grievance_shop
sirius_worker ◄──field_sirius_worker─────────── smf_worker_month ──field_grievance_shop──► grievance_shop
sirius_worker ◄──field_sirius_worker─────────── sirius_trust_worker_election ──field_grievance_shop──► grievance_shop
sirius_trust_worker_election ──trust_benefits─► sirius_trust_benefit
sirius_trust_worker_election ──contact_relations─► sirius_contact_relationship ──contact_alt──► sirius_contact
sirius_contact_relationship ──field_sirius_contact──► sirius_contact (owning side)
sirius_trust_worker_benefit ──subscriber/worker──► sirius_worker (nid range ~2.4M-22M)
sirius_trust_worker_benefit ──election────────► sirius_trust_worker_election
sirius_payment ──payer────────────────────────► sirius_worker/sirius_contact
sirius_payment ──ledger_account───────────────► sirius_ledger_account
sirius_ledger_ar.ledger_participant / .ledger_account / .ledger_reference ─► nids (worker/account/benefit-grant)
sirius_dispatch ──dispatch_job────────────────► sirius_dispatch_job ──shop──► grievance_shop
sirius_dispatch ──field_sirius_worker─────────► sirius_worker
sirius_employee ──field_sirius_worker─────────► sirius_worker; ──field_grievance_shop──► grievance_shop
sirius_employer_payperiod ──field_grievance_shop──► grievance_shop
grievance_shop_contact ──shops────────────────► grievance_shop; ──company──► grievance_company
```

Migration load order in `03-transformations.md` follows this spine bottom-up.

## Revision-history policy (summary)

**Default: `field_revision_*` is dropped.** S2 is not a revisioned system; it keeps history only in purpose-built tables. Revisions are consulted in exactly **two** places (grievance history was the third; it is void — the bundle is empty):

1. **Worker status history** — `worker_wsh` / `worker_msh` reconstructed from work-status/member-status field revisions (T6).
2. **EBA onset date** — first-Yes revision timestamp for `worker_dispatch_eba.ymd` (T9).

Everything else migrates current-state only. The full S1 snapshot should be retained (cold storage, inside the HIPAA boundary) as the audit trail substitute.
