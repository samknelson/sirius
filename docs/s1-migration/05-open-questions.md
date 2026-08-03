# Open Questions

Everything unresolvable from structure plus S2 knowledge. Grouped: blocking → semantic → masked-data → operational. Q#s/N#s are referenced from [02-mapping.md](02-mapping.md) and [03-transformations.md](03-transformations.md).

> **Revised per [06-strategy-revision.md](06-strategy-revision.md).** Closed: **Q0** (real census in 06 §4.1), **Q25** (grievance bundle has 0 nodes — descoped), **Q32** (`member` is vestigial — drop). Structurally closed by the production profile: **Q13**, **Q16**, **Q22** (the "missing" fields exist — see below). **Retired/superseded:** **Q17** (coverage month/year source) → the real question is now N1/N2; **Q21** (missing hours tables) → the payload lives in `field_sirius_json` → N9. References to Q17/Q21 in 02/03 are historical markers, not open items here. New N-series questions from 06 §7 are folded in here with owners.

**Standing rule applied throughout:** every mapping marked *(inferred)* — and especially the sample-value-derived list at the top of 02-mapping.md — needs confirmation against the live system or production aggregates. Value-level checks run inside the HIPAA boundary and emit **aggregates only, never rows**.

## Blocking (must resolve before ETL build)

- **N1 — `field_sirius_json` structure on `smf_worker_month`** (2.47M rows, `longtext`). Fixed schema or dynamic keys? Determines whether 2.5M coverage records are migratable. *(Mitchell / Sam)*
- **N2 — Is `smf_worker_month` S1's WMB record?** If yes, migrating coverage history supersedes the regenerate-from-elections plan (old Q17 / T17). Policy stakes: regeneration can differ from what S1 actually granted; retroactively revoking a granted month creates a COBRA event. *(Kristin)*
- **N9 — `field_sirius_json` structure on `sirius_payperiod`** (3.61M rows). Almost certainly carries the hours amount / employment-status payload (no other value-bearing field table exists on the bundle — supersedes old Q21's "missing tables" theory). Blocking for T20. *(Mitchell / Sam)*
- **N3 — `sirius_employer_payperiod` (18,395)** — employer-side contribution reporting; needs full mapping (02 §13a). Relevant to LD/interest work. *(Mitchell)*
- **Q38 — File blobs.** `file_managed` URIs are `private://` (+ `s3fs_file` exists). The DB has no bytes; migration of `files` (T10) needs access to the S1 private-files directory / S3 bucket.
- **Q18 — Cutover coordination.** S1's benefit scanner was still writing `mode='live'` changelog rows as of July 2026. The migration plan needs a freeze window and a final delta pass.

## Newly visible bundles needing targets

- **N4 — `sirius_employee` (539) vs `sirius_worker` (117,679)** — staff records? employment links? (02 §13c). *(Sam)*
- **N5 — `sirius_trust_provider` (12)** — carriers; needs an S2 target (02 §13b). *(Mitchell)*
- **N6 — `sirius_payment` is only 3,458 rows.** Does financial activity live primarily in `sirius_ledger_ar` (75MB data)? Affects Q20 balance-parity test design. *(Laura / Sam)*
- **N7 — configured-but-empty bundles** (06 §4.1 names 20; its "16" count contradicts its own list — reconcile against `field_config_instance` while answering) — built-and-abandoned, or purged? If purged, confirm nothing must be recovered from `field_revision_*`. Until then they are out of ETL scope. *(Sam)*
- **N8 — `sirius_twilio_conversation` (8), `grievance_company` (3), `grievance_chapter` (2)** — need targets or explicit logged DROP (02 §13d). *(Mitchell)*
- **N10 — Contact-style fields directly on `sirius_worker`** (name 117,679 / email 17,009 / phone 36,319 / address 51,962 rows *on the worker bundle*, alongside the referenced `sirius_contact` node). Which record wins when both exist? Duplicate data or fallback? Affects §1/§2 mappings and T11-T13.

## Opaque identifiers (`_id`, `_id2`, `_id3`)

- **Q2 — `field_sirius_id2` (33,615) / `field_sirius_id3` (78,887) on workers.** Sample values were masked hex. Candidates: member number, external payroll/fund IDs → `worker_ids` rows with proper `options_worker_id_type` entries. Need live semantics + which S1 screens display them. Also `field_sirius_id` exists on **every** worker (117,679) — same question.
- **Q15 — `field_sirius_id` on `sirius_trust_benefit` / `sirius_ledger_account` / `sirius_dispatch_job` / `sirius_phonenumber` / `sirius_employee`.** A per-entity external code. Decide per bundle once meaning is confirmed (on `sirius_phonenumber` it is likely the number itself — Q12).
- **Q19 — `sirius_ledger_ar.ledger_key`** (sample showed mixed `test`/numeric ids) and whether non-`Cleared` `ledger_status` values exist in production; S2's `ledger` has no status column, so any pending/void statuses need a policy.

## Semantic confirmations (inferred, must verify)

- **Q1 — Masked-in-sample columns catalog.** All columns previously flagged `MASKED` (bodies, messages/notes/json, `field_sirius_source`, `gender_nota_val`, `payrate`, `ledger_memo/_json`, address subcolumns, `users.data`, `role` names, `variable` names). The old sample proved nothing about their real fill — confirm content class with production aggregates before mapping.
- **Q3 — `field_sirius_dispatch_availdate`** (115 rows in production) = seniority date, availability date, or last-status-change timestamp? ⚠ sample-derived suspicion of defaulting — verify overlap with `hfe_until` (also 115 rows) via aggregates.
- **Q4 — HFE scope.** S1 HFE-until is worker-global; S2 `worker_dispatch_hfe` is worker+employer. Which employer(s) should imported holds apply to?
- **Q5 — EBA semantics.** Worker-level Yes/No (117,679 rows) vs S2's dated `worker_dispatch_eba` rows; and what job-level `field_sirius_dispatch_eba`/`_eba_dates` mean on `sirius_dispatch_job`.
- **Q6 — `field_sirius_dispatch_asi`** (21,416 rows) — unknown acronym.
- **Q7 — `field_sirius_skill_expire` (115) / `field_sirius_skills_availx` (117,679)** — which skill do they expire/exempt? No worker→skill field table exists in production either (**Q9 sharpened**: worker skills, if any, must live in `field_sirius_json` on the worker, taxonomy relations, or nowhere).
- **Q8 — `field_sirius_aat` / `field_sirius_aat_required`** — on all workers AND on all dispatches (51,538). Unknown acronym; need live screens.
- **Q10 — Preferred language (`field_sirius_lang`)** multi-valued (en, es). S2 has no language column — add one (contacts) or stash in `data`? Affects comms.
- **Q11 — `field_sirius_contact_tags`** — max delta **26** on contacts (544,243 field rows), 17 on `smf_worker_month` (**13.57M field rows** — S1's largest single field table). S2's `options_comm_tags` are per-message. Add a contact-tags feature, or drop?
- **Q12 — `sirius_phonenumber` number location** — `field_sirius_id` (every node) or `node.title`; and what `field_sirius_json` holds. Plus the misspelled `sirius_phonenubmer` bundle (7 title-only nodes): migrate or skip with logged reason.
- **Q14 — `field_sirius_count` / `field_sirius_count_yes`** on relationships and dispatch jobs — counts of what? ⚠ sample-derived readings.
- **Q23 — `field_sirius_dispatch_cbn`** — call-by-name? ⚠ sample-derived.
- **Q24 — `sirius_dispatch_sib` vocabulary and `field_sirius_dispatch_job_types`** — S1's dispatch-eligibility wiring. Needs a walkthrough of S1's dispatch rules before mapping to S2 eligibility plugin configs.
- **Q26 — `field_grievance_external_id`** on shops — employer number from an external system? Decide S2 home (`employers.data` vs `companies.sirius_id`).
- **Q27 — Grievance holidays** (`grievance_holiday`, 2 nodes) — where do business-day holidays live in S2's timeline computation? (Only relevant if S2's greenfield grievance build wants them.)
- **Q28 — Grievance vocab fine-mapping** — only the vocabs serving *populated* entities still matter (document types for files, alert/log types if reused). The grievance-record vocabs are descoped with the bundle.
- **Q30 — `sirius_news`** (5 nodes) — announcements feature wanted in S2, or drop?
- **Q31 — `sirius_json_definition`** (144 nodes — more real than the sample suggested) — S1's public JSON/webservice definitions vs S2 `ws_bundles`; are external consumers still calling S1 endpoints that must be re-pointed?
- **Q34 — `flag` types** — which flags are user bookmarks (→ `bookmarks`) vs workflow markers?
- **Q35 — Grievance comments** (`comment` table; comment rows confirmed present in production field tables) — with grievance descoped, decide: archive or drop.
- **Q37 — Member-status ↔ industry linkage** — sharpened by production structure: **both `field_sirius_member_status` and `field_sirius_industry` are multi-valued (max delta 3) on workers** — per-industry member status? Determines `worker_msh.industry_id`.
- **Q39 — Opt-outs.** No email/SMS opt-out fields observed in structure. Where does S1 store unsubscribe state (critical before S2 sends anything to migrated contacts)?

## Data-quality / operational

- **Q20 — Balance parity.** Payment sign conventions and `date_cleared` availability. Acceptance test: per-participant, per-account balance in S2 == S1 (`sirius_ledger_ar` + payments) to the cent — scope with N6.
- **Q29 — Log retention.** Which `sirius_log` categories (1.78M nodes) must stay queryable in S2 (vs cold archive)? Also whether bulk sends link to their per-recipient log rows.
- **Q33 — `variable` table.** Contains what look like Twilio SIDs and phone numbers; must be manually reviewed with the live system owner — never bulk-migrated (credentials belong in S2 secrets, not `variables`).
- **Q36 — SSN collisions. CONFIRMED RISK (06 §4.4):** `field_sirius_ssn_value` is `varchar(255) DEFAULT NULL` — not fixed-width, not unique, nullable; format variance (`123-45-6789` vs `123456789`) unconstrained. S2's unique constraint will reject duplicates. Need a business rule (skip, suffix, or worker-merge review queue).
- **Timezone rule:** all S1 datetimes are stored naive; per-field timezone convention (UTC vs America/Los_Angeles wall time) must be confirmed with production aggregates before casting — affects every date/datetime transform.
- **`node.changed` uniformity** was an artifact of the anonymization run in the retired sample. **Unknown for production** — re-verify with aggregates before trusting or distrusting `changed` as a business timestamp; prefer `created` and revision timestamps until then.
