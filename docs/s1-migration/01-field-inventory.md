# S1 Field Inventory (production MariaDB structure)

> **Source.** Generated from the production structure profile extracted from a temporary restore of `smf-db-prod` (MariaDB 10.6.25): `profile/columns.tsv` (real `column_type` per column), `profile/tables.tsv` (engine + approximate row counts), `profile/fielddata_stats.tsv` (per field table × entity_type × bundle: row count and max delta, filtered to `deleted=0`). **No production rows were used** — this inventory is structure and aggregates only. See [06-strategy-revision.md](06-strategy-revision.md).
>
> This file **replaces** the earlier inventory profiled from the ~10-row Neon Postgres sample. All previously "inferred" types are gone; every type below is the real MariaDB column definition. Fill rates and sample values are intentionally absent — value-level profiling must run inside the HIPAA boundary and emit aggregates only.
>
> Regenerate with: `node scripts/oneoffs/s1-inventory-from-profile.mjs`

Production schema: **818 tables** (319 `field_data_*` + 319 `field_revision_*` twins + 180 core/app tables).

Reading the tables below:
- **Value column types** are MariaDB `column_type` verbatim. `NULL` marks nullable columns.
- **rows** under usage = live rows (`deleted=0`) for that entity_type/bundle from production.
- **multi** = `max_delta > 0` in production → the field is multi-valued for that bundle and MUST be aggregated, not flat-joined.
- The only `language` value present anywhere is `und` (translation never enabled).
- Field-name prefixes (`field_grievance_*`, `field_sirius_*`) are Drupal **module namespaces, not domain markers** — check the bundle column, not the name.

## `field_data_*` tables (319)

| # | Field table | ~Total rows | Rev twin | Value column(s): real MariaDB type | Used by (entity/bundle → live rows, multi) |
|---|-------------|------------|----------|-------------------------------------|---------------------------------------------|
| 1 | `field_data_body` | 118 | yes | `…value` longtext NULL<br>`…summary` longtext NULL<br>`…format` varchar(255) NULL | `sirius_help` → 72<br>`sirius_bulk` → 16<br>`sirius_trust_benefit` → 14<br>`sirius_news` → 5<br>`grievance_basic_page` → 4<br>`grievance_letter_template` → 4<br>`page` → 3 |
| 2 | `field_data_comment_body` | 3 | yes | `…value` longtext NULL<br>`…format` varchar(255) NULL | comment/`comment_node_grievance` → 3 |
| 3 | `field_data_field_grievance_actor` | 13 | yes | `…value` varchar(255) NULL | taxonomy_term/`grievance_alert_types` → 13 |
| 4 | `field_data_field_grievance_annual` | 2 | yes | `…value` varchar(255) NULL | `grievance_holiday` → 2 |
| 5 | `field_data_field_grievance_attachments` | 175 | yes | `…fid` int(10) unsigned NULL<br>`…display` tinyint(3) unsigned<br>`…description` text NULL | `grievance_shop` → 187 **multi (max delta 5)** |
| 6 | `field_data_field_grievance_bundle` | 6 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_field_overrides` → 6 |
| 7 | `field_data_field_grievance_can_attach` | 37 | yes | `…value` varchar(255) NULL | taxonomy_term/`grievance_document_types` → 37 |
| 8 | `field_data_field_grievance_can_ir` | 7 | yes | `…value` varchar(255) NULL | taxonomy_term/`grievance_document_types` → 7 |
| 9 | `field_data_field_grievance_co_address` | 120 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 122 |
| 10 | `field_data_field_grievance_co_address_2` | 1 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 1 |
| 11 | `field_data_field_grievance_co_city` | 120 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 122 |
| 12 | `field_data_field_grievance_co_email` | 410 | yes | `…email` varchar(255) NULL | `grievance_shop_contact` → 447 |
| 13 | `field_data_field_grievance_co_fax` | 6 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 6 |
| 14 | `field_data_field_grievance_co_name` | 414 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 454 |
| 15 | `field_data_field_grievance_co_phone` | 114 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 127 |
| 16 | `field_data_field_grievance_co_phone_2` | 20 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 28 |
| 17 | `field_data_field_grievance_co_role` | 328 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 371 |
| 18 | `field_data_field_grievance_co_state` | 120 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 122 |
| 19 | `field_data_field_grievance_co_zip` | 120 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 122 |
| 20 | `field_data_field_grievance_comments` | 1 | yes | `…value` longtext NULL<br>`…summary` longtext NULL<br>`…format` varchar(255) NULL | `grievance_contract_template` → 1 |
| 21 | `field_data_field_grievance_company` | 3 | yes | `…target_id` int(10) unsigned | `grievance_shop_contact` → 3 |
| 22 | `field_data_field_grievance_contact_types` | 525 | yes | `…tid` int(10) unsigned NULL | `grievance_shop_contact` → 562 **multi (max delta 2)** |
| 23 | `field_data_field_grievance_contract` | 120 | yes | `…fid` int(10) unsigned NULL<br>`…display` tinyint(3) unsigned<br>`…description` text NULL | `grievance_shop` → 124 |
| 24 | `field_data_field_grievance_date` | 2 | yes | `…value` datetime NULL | `grievance_holiday` → 2 |
| 25 | `field_data_field_grievance_days` | 7 | yes | `…value` int(11) NULL | taxonomy_term/`sirius_skill` → 7 |
| 26 | `field_data_field_grievance_description` | 15 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop_contact` → 18<br>`grievance_field_overrides` → 1 |
| 27 | `field_data_field_grievance_entity_type` | 6 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_field_overrides` → 6 |
| 28 | `field_data_field_grievance_external_id` | 9 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop` → 10 |
| 29 | `field_data_field_grievance_field_name` | 6 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_field_overrides` → 6 |
| 30 | `field_data_field_grievance_images` | 5 | yes | `…fid` int(10) unsigned NULL<br>`…display` tinyint(3) unsigned<br>`…description` text NULL | `grievance_basic_page` → 4 **multi (max delta 3)**<br>`grievance_letter_template` → 1 |
| 31 | `field_data_field_grievance_label` | 6 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_field_overrides` → 6 |
| 32 | `field_data_field_grievance_notify_body` | 7 | yes | `…value` longtext NULL<br>`…format` varchar(255) NULL | `grievance_letter_template` → 7 |
| 33 | `field_data_field_grievance_notify_subject` | 6 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_letter_template` → 5<br>`sirius_bulk` → 1 |
| 34 | `field_data_field_grievance_open` | 3 | yes | `…value` varchar(255) NULL | taxonomy_term/`grievance_status` → 3 |
| 35 | `field_data_field_grievance_phone` | 290 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | user/`user` → 353 |
| 36 | `field_data_field_grievance_phone_off` | 3 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | user/`user` → 3 |
| 37 | `field_data_field_grievance_roles` | 6 | yes | `…value` int(11) | `grievance_letter_template` → 6 **multi (max delta 1)** |
| 38 | `field_data_field_grievance_shop` | 5,605,029 | yes | `…target_id` int(10) unsigned | `sirius_payperiod` → 3,617,328<br>`smf_worker_month` → 1,531,760<br>`sirius_trust_worker_benefit` → 572,505<br>`sirius_trust_worker_election` → 243,325<br>`sirius_employer_payperiod` → 18,395<br>`sirius_worker` → 7,489<br>`sirius_feed` → 3,226<br>`sirius_employee` → 539<br>`sirius_dispatch_job` → 319 |
| 39 | `field_data_field_grievance_shops` | 790 | yes | `…target_id` int(10) unsigned | `grievance_shop_contact` → 563 **multi (max delta 2)**<br>user/`user` → 326 |
| 40 | `field_data_field_grievance_shortname` | 6 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_letter_template` → 6 |
| 41 | `field_data_field_grievance_tags` | 2 | yes | `…tid` int(10) unsigned NULL | `grievance_shop` → 2 **multi (max delta 1)** |
| 42 | `field_data_field_grievance_timeline_show` | 2 | yes | `…value` varchar(255) NULL | taxonomy_term/`grievance_log_types` → 2 |
| 43 | `field_data_field_grievance_update_rep` | 8 | yes | `…value` varchar(255) NULL | `grievance_letter_template` → 9 |
| 44 | `field_data_field_sirius_aat` | 156,848 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_worker` → 117,679<br>`sirius_dispatch` → 51,538 |
| 45 | `field_data_field_sirius_aat_required` | 112,103 | yes | `…value` varchar(255) NULL | `sirius_worker` → 117,679 |
| 46 | `field_data_field_sirius_active` | 4,166,544 | yes | `…value` varchar(255) NULL | `sirius_payperiod` → 3,617,328<br>`sirius_trust_worker_benefit` → 609,486<br>`sirius_trust_worker_election` → 243,328<br>`sirius_contact_relationship` → 35,774<br>`sirius_employer_payperiod` → 18,395<br>`grievance_shop` → 254<br>`sirius_trust_benefit` → 19<br>`sirius_trust_provider` → 12<br>taxonomy_term/`sirius_member_status` → 7<br>`grievance_contract_template` → 1<br>`sirius_callerid` → 1<br>`sirius_domain` → 1 |
| 47 | `field_data_field_sirius_address` | 116,584 | yes | `…country` varchar(2) NULL<br>`…administrative_area` varchar(255) NULL<br>`…sub_administrative_area` varchar(255) NULL<br>`…locality` varchar(255) NULL<br>`…dependent_locality` varchar(255) NULL<br>`…postal_code` varchar(255) NULL<br>`…thoroughfare` varchar(255) NULL<br>`…premise` varchar(255) NULL<br>`…sub_premise` varchar(255) NULL<br>`…organisation_name` varchar(255) NULL<br>`…name_line` varchar(255) NULL<br>`…first_name` varchar(255) NULL<br>`…last_name` varchar(255) NULL<br>`…data` longtext NULL | `sirius_contact` → 55,493<br>`sirius_worker` → 51,962<br>`sirius_trust_provider` → 12 |
| 48 | `field_data_field_sirius_address_accuracy` | 47,058 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_contact` → 52,353 |
| 49 | `field_data_field_sirius_address_canon` | 115,200 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_contact` → 118,246 |
| 50 | `field_data_field_sirius_address_county` | 52,400 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_contact` → 51,668 |
| 51 | `field_data_field_sirius_address_geo` | 50,090 | yes | `…geom` longblob NULL<br>`…geo_type` varchar(64) NULL<br>`…lat` decimal(18,12) NULL<br>`…lon` decimal(18,12) NULL<br>`…left` decimal(18,12) NULL<br>`…top` decimal(18,12) NULL<br>`…right` decimal(18,12) NULL<br>`…bottom` decimal(18,12) NULL<br>`…geohash` varchar(16) NULL | `sirius_contact` → 52,563<br>`sirius_trust_provider` → 12 |
| 52 | `field_data_field_sirius_address_notes` | 1 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_dispatch_job` → 1 |
| 53 | `field_data_field_sirius_attachments` | 12,316 | yes | `…fid` int(10) unsigned NULL<br>`…display` tinyint(3) unsigned<br>`…description` text NULL | `sirius_log` → 10,515 **multi (max delta 10)**<br>`sirius_feed` → 3,861 **multi (max delta 1)**<br>`sirius_trust_worker_election` → 3<br>`sirius_letterhead` → 1 |
| 54 | `field_data_field_sirius_badge` | 17 | yes | `…value` varchar(255) NULL | taxonomy_term/`sirius_skill` → 17 |
| 55 | `field_data_field_sirius_boolean` | 5 | yes | `…value` varchar(255) NULL | `sirius_news` → 5 |
| 56 | `field_data_field_sirius_bulk_medium` | 43 | yes | `…value` varchar(255) NULL | `sirius_bulk` → 45 |
| 57 | `field_data_field_sirius_bulk_status` | 44 | yes | `…value` varchar(255) NULL | `sirius_bulk` → 45 |
| 58 | `field_data_field_sirius_category` | 1,121,441 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_log` → 1,782,743 |
| 59 | `field_data_field_sirius_check_number` | 1,205 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_payment` → 1,206 |
| 60 | `field_data_field_sirius_contact` | 209,495 | yes | `…target_id` int(10) unsigned | `sirius_worker` → 117,679<br>user/`user` → 62,416<br>`sirius_contact_relationship` → 35,774<br>`grievance_shop_contact` → 557 |
| 61 | `field_data_field_sirius_contact_alt` | 34,196 | yes | `…target_id` int(10) unsigned | `sirius_contact_relationship` → 35,774 |
| 62 | `field_data_field_sirius_contact_relation` | 312,018 | yes | `…target_id` int(10) unsigned | `sirius_trust_worker_benefit` → 312,447 |
| 63 | `field_data_field_sirius_contact_relations` | 29,488 | yes | `…target_id` int(10) unsigned | `sirius_trust_worker_election` → 29,464 **multi (max delta 7)** |
| 64 | `field_data_field_sirius_contact_reltype` | 34,196 | yes | `…tid` int(10) unsigned NULL | `sirius_contact_relationship` → 35,774 |
| 65 | `field_data_field_sirius_contact_tags` | 12,289,151 | yes | `…tid` int(10) unsigned NULL | `smf_worker_month` → 13,569,799 **multi (max delta 17)**<br>`sirius_contact` → 544,243 **multi (max delta 26)** |
| 66 | `field_data_field_sirius_content_types` | 38 | yes | `…value` varchar(255) NULL | taxonomy_term/`grievance_document_types` → 38 **multi (max delta 1)** |
| 67 | `field_data_field_sirius_count` | 34,196 | yes | `…value` int(11) NULL | `sirius_contact_relationship` → 35,774<br>taxonomy_term/`sirius_contact_relationship_types` → 2<br>`sirius_dispatch_job` → 1 |
| 68 | `field_data_field_sirius_count_yes` | 259 | yes | `…value` int(11) NULL | `sirius_dispatch_job` → 260 |
| 69 | `field_data_field_sirius_css_class` | 6 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | taxonomy_term/`grievance_contract_section_tags` → 6 |
| 70 | `field_data_field_sirius_currency` | 3 | yes | `…value` varchar(255) NULL | `sirius_ledger_account` → 3 |
| 71 | `field_data_field_sirius_date_end` | 3,951,439 | yes | `…value` datetime NULL | `sirius_payperiod` → 3,617,318<br>`sirius_trust_worker_benefit` → 442,235<br>`sirius_trust_worker_election` → 171,308<br>`sirius_employer_payperiod` → 18,395<br>`sirius_dispatch` → 7,114<br>`sirius_contact_relationship` → 132 |
| 72 | `field_data_field_sirius_date_start` | 6,520,633 | yes | `…value` datetime NULL | `sirius_payperiod` → 3,617,328<br>`smf_worker_month` → 2,532,136<br>`sirius_trust_worker_benefit` → 609,448<br>`sirius_trust_worker_election` → 243,325<br>`sirius_dispatch` → 51,533<br>`sirius_contact_relationship` → 35,659<br>`sirius_employer_payperiod` → 18,395 |
| 73 | `field_data_field_sirius_datetime` | 2,933,596 | yes | `…value` datetime NULL | `sirius_payperiod` → 2,936,075<br>`sirius_employer_payperiod` → 18,395<br>`sirius_payment` → 3,085<br>`sirius_bulk` → 29<br>`sirius_dispatch_job` → 4<br>`sirius_phonenumber` → 1 |
| 74 | `field_data_field_sirius_datetime_completed` | 2,933,596 | yes | `…value` datetime NULL | `sirius_payperiod` → 2,936,075<br>`sirius_employer_payperiod` → 18,395<br>`sirius_bulk` → 28<br>`sirius_news` → 5<br>`sirius_dispatch_job` → 1 |
| 75 | `field_data_field_sirius_datetime_created` | 3,443 | yes | `…value` datetime NULL | `sirius_payment` → 3,456<br>`sirius_dispatch_job` → 4 |
| 76 | `field_data_field_sirius_denorm_benefits` | 147,900 | yes | `…target_id` int(10) unsigned | `sirius_worker` → 141,216 **multi (max delta 12)** |
| 77 | `field_data_field_sirius_dispatch_asi` | 20,573 | yes | `…value` varchar(255) NULL | `sirius_worker` → 21,416 |
| 78 | `field_data_field_sirius_dispatch_available` | 20 | yes | `…value` varchar(255) NULL | taxonomy_term/`sirius_work_status` → 14<br>taxonomy_term/`sirius_dispatch_sib` → 6 |
| 79 | `field_data_field_sirius_dispatch_availdate` | 116 | yes | `…value` datetime NULL | `sirius_worker` → 115 |
| 80 | `field_data_field_sirius_dispatch_cbn` | 43,250 | yes | `…value` varchar(255) NULL | `sirius_dispatch` → 51,538 |
| 81 | `field_data_field_sirius_dispatch_eba` | 112,125 | yes | `…value` varchar(255) NULL | `sirius_worker` → 117,679<br>`sirius_dispatch_job` → 4 |
| 82 | `field_data_field_sirius_dispatch_eba_dates` | 1 | yes | `…value` datetime NULL | `sirius_dispatch_job` → 1 |
| 83 | `field_data_field_sirius_dispatch_facility` | 3 | yes | `…target_id` int(10) unsigned | `sirius_dispatch_job` → 3 |
| 84 | `field_data_field_sirius_dispatch_hfe_until` | 115 | yes | `…value` datetime NULL | `sirius_worker` → 115 |
| 85 | `field_data_field_sirius_dispatch_job` | 43,296 | yes | `…target_id` int(10) unsigned | `sirius_dispatch` → 51,538 |
| 86 | `field_data_field_sirius_dispatch_job_group` | 1 | yes | `…target_id` int(10) unsigned | `sirius_dispatch_job` → 1 |
| 87 | `field_data_field_sirius_dispatch_job_nfcns` | 1 | yes | `…value` varchar(255) NULL | `sirius_dispatch_job` → 1 |
| 88 | `field_data_field_sirius_dispatch_job_status` | 319 | yes | `…value` varchar(255) NULL | `sirius_dispatch_job` → 319 |
| 89 | `field_data_field_sirius_dispatch_job_type` | 319 | yes | `…tid` int(10) unsigned NULL | `sirius_dispatch_job` → 319 |
| 90 | `field_data_field_sirius_dispatch_job_types` | 7 | yes | `…tid` int(10) unsigned NULL | taxonomy_term/`sirius_member_status` → 4<br>`grievance_shop` → 3 |
| 91 | `field_data_field_sirius_dispatch_medium` | 111,881 | yes | `…value` varchar(255) NULL | `sirius_worker` → 117,679 |
| 92 | `field_data_field_sirius_dispatch_status` | 43,237 | yes | `…value` varchar(255) NULL | `sirius_dispatch` → 51,538 |
| 93 | `field_data_field_sirius_dispatch_type` | 43,276 | yes | `…value` varchar(255) NULL | `sirius_dispatch` → 51,538 |
| 94 | `field_data_field_sirius_dob` | 72,524 | yes | `…value` datetime NULL | `sirius_worker` → 82,919 |
| 95 | `field_data_field_sirius_dollar_amt` | 3,432 | yes | `…value` decimal(10,2) NULL | `sirius_payment` → 3,449 |
| 96 | `field_data_field_sirius_domain` | 7,356,835 | yes | `…target_id` int(10) unsigned | `sirius_payperiod` → 3,617,318<br>`smf_worker_month` → 2,532,136<br>`sirius_log` → 1,719,256<br>`sirius_trust_worker_benefit` → 609,486<br>`sirius_trust_worker_election` → 243,328<br>`sirius_contact` → 129,055<br>`sirius_worker` → 117,679<br>`sirius_dispatch` → 51,538<br>`sirius_contact_relationship` → 35,774<br>`sirius_employer_payperiod` → 18,395<br>`sirius_phonenumber` → 3,936<br>`sirius_feed` → 3,681<br>`sirius_payment` → 3,458<br>user/`user` → 3,324<br>`grievance_shop_contact` → 557<br>`sirius_employee` → 539<br>`sirius_dispatch_job` → 318<br>`grievance_shop` → 254<br>`sirius_json_definition` → 108<br>taxonomy_term/`sirius_contact_tags` → 97<br>`sirius_bulk` → 44<br>`sirius_trust_benefit` → 19<br>`sirius_trust_provider` → 12<br>taxonomy_term/`sirius_hour_type` → 11<br>taxonomy_term/`sirius_contact_relationship_types` → 9<br>taxonomy_term/`sirius_trust_benefit_type` → 9<br>taxonomy_term/`sirius_work_status` → 9<br>taxonomy_term/`grievance_contact_types` → 8<br>taxonomy_term/`sirius_payment_type` → 8<br>`grievance_letter_template` → 7<br>taxonomy_term/`sirius_member_status` → 7<br>taxonomy_term/`sirius_event_participant_status` → 6<br>`sirius_news` → 5<br>taxonomy_term/`sirius_gender` → 5<br>taxonomy_term/`sirius_industry` → 4<br>taxonomy_term/`sirius_trust_election_type` → 4<br>`sirius_ledger_account` → 3<br>taxonomy_term/`sirius_event_participant_role` → 3<br>`grievance_basic_page` → 2<br>taxonomy_term/`sirius_event_type` → 2<br>`grievance_contract_template` → 1<br>`sirius_callerid` → 1<br>`sirius_dispatch_facility` → 1<br>`sirius_letterhead` → 1<br>taxonomy_term/`grievance_department` → 1<br>taxonomy_term/`grievance_document_types` → 1<br>taxonomy_term/`sirius_dispatch_job_type` → 1<br>taxonomy_term/`sirius_ledger_type` → 1 |
| 97 | `field_data_field_sirius_email` | 49,816 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_contact` → 28,404<br>`sirius_worker` → 17,009 |
| 98 | `field_data_field_sirius_emails` | 11 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_dispatch_job` → 11 **multi (max delta 9)** |
| 99 | `field_data_field_sirius_event_proles` | 31 | yes | `…tid` int(10) unsigned NULL | taxonomy_term/`sirius_event_participant_status` → 24 **multi (max delta 3)**<br>taxonomy_term/`sirius_event_type` → 7 **multi (max delta 2)** |
| 100 | `field_data_field_sirius_fastload_status` | 20,027 | yes | `…value` varchar(255) NULL | `sirius_log` → 10,027<br>`sirius_contact` → 10,000 |
| 101 | `field_data_field_sirius_feed_status` | 3,614 | yes | `…value` varchar(255) NULL | `sirius_feed` → 3,684 |
| 102 | `field_data_field_sirius_gender` | 79,423 | yes | `…tid` int(10) unsigned NULL | `sirius_worker` → 80,448 |
| 103 | `field_data_field_sirius_gender_nota_calc` | 112,376 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_worker` → 117,679 |
| 104 | `field_data_field_sirius_gender_nota_val` | 1,015 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_worker` → 1,195 |
| 105 | `field_data_field_sirius_headshot` | 2 | yes | `…fid` int(10) unsigned NULL<br>`…alt` varchar(512) NULL<br>`…title` varchar(1024) NULL<br>`…width` int(10) unsigned NULL<br>`…height` int(10) unsigned NULL | `sirius_worker` → 2 |
| 106 | `field_data_field_sirius_id` | 125,564 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_worker` → 117,679<br>`sirius_contact` → 10,000<br>`sirius_phonenumber` → 3,952<br>`sirius_payment` → 819<br>`sirius_employee` → 539<br>`grievance_shop` → 233<br>taxonomy_term/`sirius_skill` → 156<br>taxonomy_term/`sirius_contact_tags` → 80<br>`sirius_trust_benefit` → 19<br>taxonomy_term/`sirius_contact_relationship_types` → 10<br>taxonomy_term/`sirius_hour_type` → 10<br>taxonomy_term/`sirius_trust_benefit_type` → 9<br>taxonomy_term/`sirius_member_status` → 7<br>taxonomy_term/`sirius_work_status` → 7<br>taxonomy_term/`sirius_gender` → 5<br>taxonomy_term/`grievance_job_classification` → 4<br>taxonomy_term/`sirius_industry` → 4<br>`sirius_ledger_account` → 3<br>taxonomy_term/`sirius_trust_election_type` → 3<br>`sirius_dispatch_job` → 2<br>taxonomy_term/`grievance_department` → 1<br>taxonomy_term/`grievance_log_types` → 1 |
| 107 | `field_data_field_sirius_id2` | 33,957 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_worker` → 33,615<br>`sirius_dispatch_job` → 316<br>taxonomy_term/`sirius_skill` → 156<br>taxonomy_term/`sirius_work_status` → 5 |
| 108 | `field_data_field_sirius_id3` | 78,771 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_worker` → 78,887 |
| 109 | `field_data_field_sirius_industry` | 65,287 | yes | `…tid` int(10) unsigned NULL | `sirius_worker` → 68,836 **multi (max delta 3)**<br>`sirius_dispatch_job` → 319<br>`grievance_shop` → 256 **multi (max delta 3)**<br>taxonomy_term/`sirius_member_status` → 7<br>taxonomy_term/`sirius_skill` → 1 |
| 110 | `field_data_field_sirius_json` | 5,246,517 | yes | `…value` longtext NULL<br>`json_denorm_external_id` varchar(255) NULL | `sirius_payperiod` → 3,613,866<br>`smf_worker_month` → 2,474,169<br>`sirius_trust_worker_benefit` → 253,926<br>`sirius_log` → 247,099<br>`sirius_contact` → 128,248<br>`sirius_worker` → 116,605<br>`sirius_phonenumber` → 3,952<br>`sirius_feed` → 3,541<br>`sirius_payment` → 540<br>`grievance_shop` → 248<br>`sirius_json_definition` → 140<br>`sirius_bulk` → 38<br>`sirius_trust_provider` → 12<br>taxonomy_term/`grievance_contact_types` → 11<br>taxonomy_term/`sirius_contact_tags` → 11<br>taxonomy_term/`sirius_dispatch_job_type` → 10<br>taxonomy_term/`sirius_event_participant_status` → 9<br>taxonomy_term/`sirius_payment_type` → 8<br>taxonomy_term/`sirius_member_status` → 7<br>`sirius_trust_benefit` → 4<br>user/`user` → 4<br>`sirius_ledger_account` → 3<br>taxonomy_term/`sirius_event_participant_role` → 3<br>taxonomy_term/`sirius_event_type` → 3<br>taxonomy_term/`sirius_industry` → 3<br>taxonomy_term/`sirius_trust_election_type` → 2<br>`grievance_letter_template` → 1<br>`sirius_domain` → 1<br>`sirius_letterhead` → 1 |
| 111 | `field_data_field_sirius_lang` | 1,329 | yes | `…value` varchar(255) NULL | `sirius_contact` → 1,345 **multi (max delta 4)** |
| 112 | `field_data_field_sirius_ledger_account` | 3,441 | yes | `…target_id` int(10) unsigned | `sirius_payment` → 3,458 |
| 113 | `field_data_field_sirius_ledger_allocated` | 3,441 | yes | `…value` varchar(255) NULL | `sirius_payment` → 3,458 |
| 114 | `field_data_field_sirius_letter_content_type` | 13 | yes | `…value` varchar(255) NULL | `grievance_letter_template` → 14 **multi (max delta 1)** |
| 115 | `field_data_field_sirius_letterhead_format` | 0 | yes | `…value` varchar(255) NULL | `sirius_letterhead` → 1 |
| 116 | `field_data_field_sirius_log_handler` | 720,652 | yes | `…target_id` int(10) unsigned | `sirius_log` → 1,803,812 **multi (max delta 19)** |
| 117 | `field_data_field_sirius_member_active` | 14 | yes | `…value` varchar(255) NULL | taxonomy_term/`sirius_work_status` → 14 |
| 118 | `field_data_field_sirius_member_status` | 69,724 | yes | `…tid` int(10) unsigned NULL | `sirius_worker` → 68,673 **multi (max delta 3)**<br>`sirius_dispatch_job` → 196 **multi (max delta 2)** |
| 119 | `field_data_field_sirius_merchant_name` | 1,835 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_payment` → 1,848 |
| 120 | `field_data_field_sirius_message` | 1,040,504 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_log` → 1,772,699 |
| 121 | `field_data_field_sirius_mustlog` | 8 | yes | `…value` varchar(255) NULL | `grievance_letter_template` → 9 |
| 122 | `field_data_field_sirius_name` | 237,918 | yes | `…title` varchar(255) NULL<br>`…given` varchar(255) NULL<br>`…middle` varchar(255) NULL<br>`…family` varchar(255) NULL<br>`…generational` varchar(255) NULL<br>`…credentials` varchar(255) NULL | `sirius_contact` → 131,581<br>`sirius_worker` → 117,679 |
| 123 | `field_data_field_sirius_name_alt` | 10 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | taxonomy_term/`sirius_contact_relationship_types` → 10 |
| 124 | `field_data_field_sirius_name_display` | 17 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | taxonomy_term/`sirius_dispatch_job_type` → 10<br>taxonomy_term/`sirius_dispatch_sib` → 6<br>`sirius_callerid` → 1 |
| 125 | `field_data_field_sirius_name_short` | 17 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | taxonomy_term/`sirius_skill` → 10<br>taxonomy_term/`sirius_gender` → 5<br>`sirius_domain` → 1<br>`sirius_ledger_account` → 1 |
| 126 | `field_data_field_sirius_name_tts` | 2 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `grievance_shop` → 2 |
| 127 | `field_data_field_sirius_nota` | 1 | yes | `…value` varchar(255) NULL | taxonomy_term/`sirius_gender` → 1 |
| 128 | `field_data_field_sirius_notes` | 1,885,070 | yes | `…value` longtext NULL<br>`…format` varchar(255) NULL | `sirius_log` → 1,770,448<br>`sirius_trust_worker_benefit` → 609,349<br>`sirius_payment` → 2,063<br>`sirius_dispatch_job` → 2<br>`sirius_payperiod` → 1 |
| 129 | `field_data_field_sirius_notify` | 4 | yes | `…value` varchar(255) NULL | `sirius_dispatch_job` → 4 |
| 130 | `field_data_field_sirius_paths` | 211 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_help` → 212 **multi (max delta 6)** |
| 131 | `field_data_field_sirius_payer` | 3,401 | yes | `…target_id` int(10) unsigned | `sirius_payment` → 3,418 |
| 132 | `field_data_field_sirius_payment_status` | 3,438 | yes | `…value` varchar(255) NULL | `sirius_payment` → 3,455 |
| 133 | `field_data_field_sirius_payment_type` | 3,438 | yes | `…tid` int(10) unsigned NULL | `sirius_payment` → 3,455 |
| 134 | `field_data_field_sirius_payperiod_type` | 1 | yes | `…value` varchar(255) NULL | `sirius_payperiod` → 1 |
| 135 | `field_data_field_sirius_payrate` | 20,977 | yes | `…value` decimal(10,2) NULL | `sirius_dispatch` → 22,191 |
| 136 | `field_data_field_sirius_phone` | 71,124 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_contact` → 49,561<br>`sirius_worker` → 36,319<br>`sirius_callerid` → 1 |
| 137 | `field_data_field_sirius_phone_alt` | 1,842 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_contact` → 1,108<br>`sirius_worker` → 752 |
| 138 | `field_data_field_sirius_phone_mobile` | 25 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_worker` → 25 |
| 139 | `field_data_field_sirius_public` | 7 | yes | `…value` varchar(255) NULL | `sirius_json_definition` → 5<br>`grievance_basic_page` → 2 |
| 140 | `field_data_field_sirius_rawhtml` | 0 | yes | `…value` longtext NULL<br>`…format` varchar(255) NULL | `grievance_letter_template` → 1 |
| 141 | `field_data_field_sirius_roles` | 32 | yes | `…value` int(11) | taxonomy_term/`grievance_document_types` → 19 **multi (max delta 6)**<br>`sirius_news` → 11 **multi (max delta 3)**<br>taxonomy_term/`sirius_member_status` → 2 |
| 142 | `field_data_field_sirius_signature` | 2 | yes | `…fid` int(10) unsigned NULL<br>`…alt` varchar(512) NULL<br>`…title` varchar(1024) NULL<br>`…width` int(10) unsigned NULL<br>`…height` int(10) unsigned NULL | user/`user` → 2 |
| 143 | `field_data_field_sirius_skill_expire` | 115 | yes | `…value` datetime NULL | `sirius_worker` → 115 |
| 144 | `field_data_field_sirius_skills_availx` | 112,014 | yes | `…value` varchar(255) NULL | `sirius_worker` → 117,679 |
| 145 | `field_data_field_sirius_sms` | 23 | yes | `…value` longtext NULL<br>`…format` varchar(255) NULL | `sirius_bulk` → 23 |
| 146 | `field_data_field_sirius_sms_possible` | 2,688 | yes | `…value` varchar(255) NULL | `sirius_phonenumber` → 3,952 |
| 147 | `field_data_field_sirius_source` | 67,925 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_contact` → 58,934 |
| 148 | `field_data_field_sirius_ssn` | 112,038 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_worker` → 117,566 |
| 149 | `field_data_field_sirius_summary` | 739,150 | yes | `…value` longtext NULL<br>`…format` varchar(255) NULL | `sirius_log` → 1,772,684<br>`sirius_help` → 164 |
| 150 | `field_data_field_sirius_term_proxy` | 254 | yes | `…target_id` int(10) unsigned | `sirius_term_proxy` → 254 |
| 151 | `field_data_field_sirius_term_source` | 11 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | taxonomy_term/`sirius_event_participant_status` → 6<br>taxonomy_term/`sirius_event_participant_role` → 3<br>taxonomy_term/`sirius_event_type` → 2 |
| 152 | `field_data_field_sirius_trust_benefit` | 607,020 | yes | `…target_id` int(10) unsigned | `sirius_trust_worker_benefit` → 609,445 |
| 153 | `field_data_field_sirius_trust_benefit_type` | 20 | yes | `…tid` int(10) unsigned NULL | `sirius_trust_benefit` → 19 |
| 154 | `field_data_field_sirius_trust_benefits` | 665,028 | yes | `…target_id` int(10) unsigned | `sirius_trust_worker_election` → 814,823 **multi (max delta 10)** |
| 155 | `field_data_field_sirius_trust_election` | 506,729 | yes | `…target_id` int(10) unsigned | `sirius_trust_worker_benefit` → 517,841 |
| 156 | `field_data_field_sirius_trust_election_type` | 60,900 | yes | `…tid` int(10) unsigned NULL | `sirius_trust_worker_election` → 62,032 |
| 157 | `field_data_field_sirius_trust_policy` | 223,909 | yes | `…target_id` int(10) unsigned | `sirius_trust_worker_election` → 242,545 |
| 158 | `field_data_field_sirius_trust_subscriber` | 599,578 | yes | `…target_id` int(10) unsigned | `sirius_trust_worker_benefit` → 609,486 |
| 159 | `field_data_field_sirius_type` | 1,074,679 | yes | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL | `sirius_log` → 1,782,741<br>`sirius_feed` → 3,684<br>`sirius_json_definition` → 144 |
| 160 | `field_data_field_sirius_tz` | 1 | yes | `…value` varchar(32) NULL | `sirius_domain` → 1 |
| 161 | `field_data_field_sirius_voice` | 1 | yes | `…value` longtext NULL<br>`…format` varchar(255) NULL | `sirius_bulk` → 1 |
| 162 | `field_data_field_sirius_voice_possible` | 2,688 | yes | `…value` varchar(255) NULL | `sirius_phonenumber` → 3,952 |
| 163 | `field_data_field_sirius_work_status` | 167 | yes | `…tid` int(10) unsigned NULL | `sirius_worker` → 167 |
| 164 | `field_data_field_sirius_worker` | 6,483,395 | yes | `…target_id` int(10) unsigned | `sirius_payperiod` → 3,617,328<br>`smf_worker_month` → 2,532,136<br>`sirius_trust_worker_benefit` → 609,480<br>`sirius_trust_worker_election` → 243,325<br>user/`user` → 62,047<br>`sirius_dispatch` → 51,538<br>`sirius_employee` → 539 |
| 165 | `field_data_field_sirius_worker_dispstatus` | 814 | yes | `…tid` int(10) unsigned NULL | `sirius_worker` → 805 |

### `field_data_*` tables with zero live rows (154)

Configured field storage with no `deleted=0` rows for any entity type. **Not ETL targets.** Listed for completeness:

| Field table | ~Total rows (incl. deleted) | Value column(s) |
|---|---|---|
| `field_data_field_field_grievance_resproc_ua` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_file_image_alt_text` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_file_image_title_text` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_address` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_address_2` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_alert` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_alert_date` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_alert_tid` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_alert_waived` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_amt` | 0 | `…value` decimal(10,2) NULL |
| `field_data_field_grievance_amt_rcvd` | 0 | `…value` decimal(10,2) NULL |
| `field_data_field_grievance_arbitration_a` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_arbitration_b` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_arbitration_c` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_arbitration_d` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_artsel` | 0 | `…value` varchar(255) NULL |
| `field_data_field_grievance_assignee_notes` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_broughtby` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_category` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_chapter` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_checkno` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_city` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_class_tid` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_classaction` | 0 | `…value` varchar(255) NULL |
| `field_data_field_grievance_classification` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_classifications` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_clause` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_clauseref` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_cont_sec_tags` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_cont_tplt_tags` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_contact_selector` | 0 |  |
| `field_data_field_grievance_contract_section` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_contract_tplt` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_contract_tplts` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_corrected` | 0 | `…value` varchar(255) NULL |
| `field_data_field_grievance_css` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_data_alert` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_date_1` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_date_2` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_days_type` | 0 | `…value` varchar(255) NULL |
| `field_data_field_grievance_daysoff` | 0 | `…value` varchar(255) NULL |
| `field_data_field_grievance_default` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_department` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_department_tid` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_departments` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_document_type` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_document_types` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_dummy` | 0 | `…value` varchar(255) NULL |
| `field_data_field_grievance_ein` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_email` | 0 | `…email` varchar(255) NULL |
| `field_data_field_grievance_emails` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_emp_name` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_first_name` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_from_status` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_gender` | 0 | `…value` varchar(255) NULL |
| `field_data_field_grievance_hidefields` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_hire_date` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_holidays` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_id` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_inforeq` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_last_name` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_log_tags` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_log_type` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_meeting_date` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_min` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_next_status` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_outcome` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_pullclause` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_remedy` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_remedy_other` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_rep_assignee` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_rep_filed` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_rep_lead` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_rep_manager` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_rep_organizer` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_rep_watching` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_grievance_resproc` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_resproc_an` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_resproc_cd` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_resproc_ea` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_resproc_er` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_resproc_hd` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_resproc_lh` | 0 | `…value` int(11) NULL |
| `field_data_field_grievance_resproc_ur` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_section_number` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_settlement_tags` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_shift` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_st_email` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_st_name` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_st_phone` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_st_selector` | 0 |  |
| `field_data_field_grievance_state` | 0 | `…value` varchar(2) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_status` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_status_date` | 0 | `…value` datetime NULL |
| `field_data_field_grievance_statuses` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_supervisor_name` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_supervisor_title` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_supervisor_unit` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_type` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_type_other` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_valid` | 0 | `…value` datetime NULL<br>`…value2` datetime NULL |
| `field_data_field_grievance_violation` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievance_weight` | 0 | `…value` int(11) NULL |
| `field_data_field_grievance_work_status` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_grievance_zip` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_grievanct_cont_clse_tags` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_address_parking` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_audio` | 0 | `…fid` int(10) unsigned NULL<br>`…display` tinyint(3) unsigned<br>`…description` text NULL |
| `field_data_field_sirius_audio_public` | 0 | `…fid` int(10) unsigned NULL<br>`…display` tinyint(3) unsigned<br>`…description` text NULL |
| `field_data_field_sirius_batch_max` | 0 | `…value` int(11) NULL |
| `field_data_field_sirius_batch_min` | 0 | `…value` int(11) NULL |
| `field_data_field_sirius_batch_ratio` | 0 | `…value` decimal(10,2) NULL |
| `field_data_field_sirius_bu` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_callerids` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_count_no` | 0 | `…value` int(11) NULL |
| `field_data_field_sirius_count_notified` | 0 | `…value` int(11) NULL |
| `field_data_field_sirius_daterepeat` | 0 | `…value` datetime NULL<br>`…value2` datetime NULL<br>`…rrule` text NULL |
| `field_data_field_sirius_denorm_level` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_dispatch_3sen` | 0 | `…value` varchar(255) NULL |
| `field_data_field_sirius_dispatch_days` | 0 | `…value` int(11) NULL |
| `field_data_field_sirius_dispatch_dncs` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_dispatch_dncs2` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_dispatch_hall` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_dispatch_hfe` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_dispatch_job_tags` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_dispatch_roles` | 0 | `…value` int(11) |
| `field_data_field_sirius_dispatch_sib_status` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_docret_key` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_docret_mode` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_edls_sheet_status` | 0 | `…value` varchar(255) NULL |
| `field_data_field_sirius_email_possible` | 0 | `…value` varchar(255) NULL |
| `field_data_field_sirius_event` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_event_prole` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_event_pstatus` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_event_type` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_events` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_hour_type` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_job_number` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_json_definition` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_ledger_category` | 0 | `…value` varchar(255) NULL |
| `field_data_field_sirius_log` | 0 | `…value` longtext NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_page` | 0 | `…value` varchar(8) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_payrate_skilled` | 0 | `…value` decimal(10,2) NULL |
| `field_data_field_sirius_phone_fax` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_provider_npi` | 0 | `…value` varchar(20) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_representatives` | 0 | `…target_id` int(10) unsigned |
| `field_data_field_sirius_skill` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_skills_avail` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_timelimit` | 0 | `…value` decimal(10,2) NULL |
| `field_data_field_sirius_title` | 0 | `…value` varchar(255) NULL<br>`…format` varchar(255) NULL |
| `field_data_field_sirius_trust_prov_levels` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_trust_service_type` | 0 | `…tid` int(10) unsigned NULL |
| `field_data_field_sirius_users` | 0 | `…target_id` int(10) unsigned |

## Application tables (non-field `sirius_*`)

### `sirius_denorm_queue` — ~1,455 rows (0.1 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `denorm_id` | int(11) | NO | ~NULL~ | PRI |
| `denorm_created_ts` | int(11) | YES | NULL | MUL |
| `denorm_updated_ts` | int(11) | YES | NULL | MUL |
| `denorm_source_nid` | int(11) | YES | NULL | MUL |
| `denorm_target_nid` | int(11) | YES | NULL | MUL |
| `denorm_status` | varchar(255) | YES | NULL |  |
| `denorm_trigger` | varchar(255) | YES | NULL |  |
| `denorm_trigger_args` | longtext | YES | NULL |  |

### `sirius_dispatch_elig_cache` — ~0 rows (0.0 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `job_nid` | int(11) | NO | ~NULL~ | PRI |
| `worker_nid` | int(11) | NO | ~NULL~ | PRI |
| `plugin` | varchar(255) | YES | NULL |  |
| `details` | text | YES | NULL |  |
| `ts` | int(11) | YES | NULL |  |

### `sirius_hours_cache` — ~3,342,280 rows (429.0 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `payperiod_nid` | int(11) | YES | NULL | MUL |
| `year` | int(11) | YES | NULL | MUL |
| `month` | int(11) | YES | NULL |  |
| `day` | int(11) | YES | NULL |  |
| `worker_nid` | int(11) | YES | NULL | MUL |
| `employer_nid` | int(11) | YES | NULL | MUL |
| `hours_type_tid` | int(11) | YES | NULL |  |
| `department_tid` | int(11) | YES | NULL |  |
| `total` | decimal(10,2) | YES | NULL |  |
| `worker_name` | varchar(255) | YES | NULL |  |
| `employer_name` | varchar(255) | YES | NULL |  |
| `hours_type_name` | varchar(255) | YES | NULL |  |
| `department_name` | varchar(255) | YES | NULL |  |
| `hours` | decimal(10,4) | YES | NULL |  |

### `sirius_ledger_ar` — ~109,451 rows (59.4 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `ledger_id` | int(11) | NO | ~NULL~ | PRI |
| `ledger_amount` | decimal(10,2) | YES | NULL |  |
| `ledger_status` | varchar(100) | YES | NULL |  |
| `ledger_account` | int(11) | YES | NULL | MUL |
| `ledger_participant` | int(11) | YES | NULL | MUL |
| `ledger_reference` | int(11) | YES | NULL | MUL |
| `ledger_ts` | int(11) | YES | NULL |  |
| `ledger_memo` | varchar(255) | YES | NULL |  |
| `ledger_key` | varchar(255) | YES | NULL | MUL |
| `ledger_json` | longtext | YES | NULL |  |

### `sirius_ledger_balance` — ~728 rows (0.0 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `balance_participant` | int(11) | NO | ~NULL~ | PRI |
| `balance_account` | int(11) | NO | ~NULL~ | PRI |
| `balance_amount` | decimal(10,2) | YES | NULL |  |

### `sirius_lock` — ~0 rows (0.0 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | varchar(255) | NO | ~NULL~ | PRI |
| `type` | varchar(255) | NO | ~NULL~ | PRI |
| `uid` | int(11) | YES | NULL | MUL |
| `ts` | int(11) | YES | NULL |  |

### `sirius_postal_lob_cache` — ~460 rows (14.6 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `cache_uuid` | varchar(1024) | NO | ~NULL~ | PRI |
| `cache_body` | longtext | YES | NULL |  |
| `cache_created` | int(11) | YES | NULL |  |

### `sirius_quickhash` — ~1 rows (0.0 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `hash_key` | varchar(1024) | NO | ~NULL~ | PRI |
| `hash_json` | longtext | YES | NULL |  |
| `hash_type` | varchar(255) | YES | NULL |  |
| `hash_domain` | int(11) | YES | NULL |  |
| `hash_uid` | int(11) | YES | NULL |  |
| `hash_ts` | int(11) | YES | NULL |  |

### `sirius_sched` — ~0 rows (0.0 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | int(11) | NO | ~NULL~ | PRI |
| `entity_nid` | int(11) | YES | NULL | MUL |
| `handler_nid` | int(11) | YES | NULL | MUL |
| `type` | varchar(255) | YES | NULL |  |
| `start_ts` | int(11) | YES | NULL | MUL |
| `end_ts` | int(11) | YES | NULL | MUL |
| `title` | varchar(255) | YES | NULL |  |
| `json` | longtext | YES | NULL |  |

### `sirius_trust_wb_scan_changelog` — ~2,663,510 rows (295.3 MB data)

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `log_nid` | int(11) | NO | ~NULL~ | PRI |
| `ts` | int(11) | YES | NULL |  |
| `mode` | varchar(255) | YES | NULL |  |
| `scan` | varchar(255) | YES | NULL |  |
| `wb_nid` | int(11) | YES | NULL |  |
| `subscriber_worker_nid` | int(11) | YES | NULL |  |
| `dependent_worker_nid` | int(11) | YES | NULL |  |
| `relationship_nid` | int(11) | YES | NULL |  |
| `benefit_nid` | int(11) | YES | NULL |  |
| `msg` | varchar(255) | YES | NULL |  |
| `action` | varchar(255) | YES | NULL |  |

## D7 core tables of migration interest

### `node` — ~7,497,455 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `nid` | int(10) unsigned | NO | ~NULL~ | PRI |
| `vid` | int(10) unsigned | YES | NULL | UNI |
| `type` | varchar(32) | NO | '' | MUL |
| `language` | varchar(12) | NO | '' | MUL |
| `title` | varchar(255) | NO | '' | MUL |
| `uid` | int(11) | NO | 0 | MUL |
| `status` | int(11) | NO | 1 | MUL |
| `created` | int(11) | NO | 0 | MUL |
| `changed` | int(11) | NO | 0 | MUL |
| `comment` | int(11) | NO | 0 |  |
| `promote` | int(11) | NO | 0 | MUL |
| `sticky` | int(11) | NO | 0 |  |
| `tnid` | int(10) unsigned | NO | 0 | MUL |
| `translate` | int(11) | NO | 0 | MUL |
| `uuid` | char(36) | NO | '' | MUL |

### `node_revision` — ~7,133,973 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `nid` | int(10) unsigned | NO | 0 | MUL |
| `vid` | int(10) unsigned | NO | ~NULL~ | PRI |
| `uid` | int(11) | NO | 0 | MUL |
| `title` | varchar(255) | NO | '' |  |
| `log` | longtext | NO | ~NULL~ |  |
| `timestamp` | int(11) | NO | 0 |  |
| `status` | int(11) | NO | 1 |  |
| `comment` | int(11) | NO | 0 |  |
| `promote` | int(11) | NO | 0 |  |
| `sticky` | int(11) | NO | 0 |  |
| `ds_switch` | varchar(255) | NO | '' |  |
| `vuuid` | char(36) | NO | '' | MUL |

### `users` — ~3,286 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `uid` | int(10) unsigned | NO | 0 | PRI |
| `name` | varchar(60) | NO | '' | UNI |
| `pass` | varchar(128) | NO | '' |  |
| `mail` | varchar(254) | YES | '' | MUL |
| `theme` | varchar(255) | NO | '' |  |
| `signature` | varchar(255) | NO | '' |  |
| `signature_format` | varchar(255) | YES | NULL |  |
| `created` | int(11) | NO | 0 | MUL |
| `access` | int(11) | NO | 0 | MUL |
| `login` | int(11) | NO | 0 |  |
| `status` | tinyint(4) | NO | 0 |  |
| `timezone` | varchar(32) | YES | NULL |  |
| `language` | varchar(12) | NO | '' |  |
| `picture` | int(11) | NO | 0 | MUL |
| `init` | varchar(254) | YES | '' |  |
| `data` | longblob | YES | NULL |  |
| `uuid` | char(36) | NO | '' | MUL |
| `changed` | int(11) | NO | 0 | MUL |

### `users_roles` — ~2,079 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `uid` | int(10) unsigned | NO | 0 | PRI |
| `rid` | int(10) unsigned | NO | 0 | PRI |

### `role` — ~12 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `rid` | int(10) unsigned | NO | ~NULL~ | PRI |
| `name` | varchar(64) | NO | '' | UNI |
| `weight` | int(11) | NO | 0 |  |

### `authmap` — ~786 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `aid` | int(10) unsigned | NO | ~NULL~ | PRI |
| `uid` | int(11) | NO | 0 | MUL |
| `authname` | varchar(128) | NO | '' | UNI |
| `module` | varchar(128) | NO | '' |  |

### `taxonomy_vocabulary` — ~47 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `vid` | int(10) unsigned | NO | ~NULL~ | PRI |
| `name` | varchar(255) | NO | '' |  |
| `machine_name` | varchar(255) | NO | '' | UNI |
| `description` | longtext | YES | NULL |  |
| `hierarchy` | tinyint(3) unsigned | NO | 0 |  |
| `module` | varchar(255) | NO | '' |  |
| `weight` | int(11) | NO | 0 | MUL |

### `taxonomy_term_data` — ~636 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `tid` | int(10) unsigned | NO | ~NULL~ | PRI |
| `vid` | int(10) unsigned | NO | 0 | MUL |
| `name` | varchar(255) | NO | '' | MUL |
| `description` | longtext | YES | NULL |  |
| `format` | varchar(255) | YES | NULL |  |
| `weight` | int(11) | NO | 0 |  |
| `hweight` | int(11) | NO | 0 |  |
| `hdepth` | int(11) | NO | 0 |  |
| `uuid` | char(36) | NO | '' | MUL |

### `taxonomy_term_hierarchy` — ~612 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `tid` | int(10) unsigned | NO | 0 | PRI |
| `parent` | int(10) unsigned | NO | 0 | PRI |

### `file_managed` — ~5,665 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `fid` | int(10) unsigned | NO | ~NULL~ | PRI |
| `uid` | int(10) unsigned | NO | 0 | MUL |
| `filename` | varchar(255) | NO | '' |  |
| `uri` | varchar(255) | NO | '' | UNI |
| `filemime` | varchar(255) | NO | '' |  |
| `filesize` | bigint(20) unsigned | NO | 0 |  |
| `status` | tinyint(4) | NO | 0 | MUL |
| `timestamp` | int(10) unsigned | NO | 0 | MUL |
| `origname` | varchar(255) | NO | '' |  |
| `uuid` | char(36) | NO | '' | MUL |

### `file_usage` — ~14,955 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `fid` | int(10) unsigned | NO | ~NULL~ | PRI |
| `module` | varchar(255) | NO | '' | PRI |
| `type` | varchar(64) | NO | '' | PRI |
| `id` | int(10) unsigned | NO | 0 | PRI |
| `count` | int(10) unsigned | NO | 0 |  |

### `s3fs_file` — ~1,030 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `uri` | varchar(255) | NO | '' | PRI |
| `filesize` | bigint(20) unsigned | NO | 0 |  |
| `timestamp` | int(10) unsigned | NO | 0 |  |
| `dir` | int(11) | NO | 0 |  |
| `version` | varchar(32) | YES | '' |  |

### `field_config` — ~295 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | int(11) | NO | ~NULL~ | PRI |
| `field_name` | varchar(32) | NO | ~NULL~ | MUL |
| `type` | varchar(128) | NO | ~NULL~ | MUL |
| `module` | varchar(128) | NO | '' | MUL |
| `active` | tinyint(4) | NO | 0 | MUL |
| `storage_type` | varchar(128) | NO | ~NULL~ | MUL |
| `storage_module` | varchar(128) | NO | '' | MUL |
| `storage_active` | tinyint(4) | NO | 0 | MUL |
| `locked` | tinyint(4) | NO | 0 |  |
| `data` | longblob | NO | ~NULL~ |  |
| `cardinality` | tinyint(4) | NO | 0 |  |
| `translatable` | tinyint(4) | NO | 0 |  |
| `deleted` | tinyint(4) | NO | 0 | MUL |

### `field_config_instance` — ~736 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | int(11) | NO | ~NULL~ | PRI |
| `field_id` | int(11) | NO | ~NULL~ |  |
| `field_name` | varchar(32) | NO | '' | MUL |
| `entity_type` | varchar(32) | NO | '' |  |
| `bundle` | varchar(128) | NO | '' |  |
| `data` | longblob | NO | ~NULL~ |  |
| `deleted` | tinyint(4) | NO | 0 | MUL |

### `comment` — ~3 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `cid` | int(11) | NO | ~NULL~ | PRI |
| `pid` | int(11) | NO | 0 | MUL |
| `nid` | int(11) | NO | 0 | MUL |
| `uid` | int(11) | NO | 0 | MUL |
| `subject` | varchar(64) | NO | '' |  |
| `hostname` | varchar(128) | NO | '' |  |
| `created` | int(11) | NO | 0 | MUL |
| `changed` | int(11) | NO | 0 |  |
| `status` | tinyint(3) unsigned | NO | 1 |  |
| `thread` | varchar(255) | NO | ~NULL~ |  |
| `name` | varchar(60) | YES | NULL |  |
| `mail` | varchar(64) | YES | NULL |  |
| `homepage` | varchar(255) | YES | NULL |  |
| `language` | varchar(12) | NO | '' |  |

### `flag` — ~1 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `fid` | smallint(5) unsigned | NO | ~NULL~ | PRI |
| `entity_type` | varchar(128) | NO | '' |  |
| `name` | varchar(32) | YES | '' | UNI |
| `title` | varchar(255) | YES | '' |  |
| `global` | tinyint(4) | YES | 0 |  |
| `options` | text | YES | NULL |  |

### `flagging` — ~245 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `flagging_id` | int(10) unsigned | NO | ~NULL~ | PRI |
| `fid` | smallint(5) unsigned | NO | 0 | MUL |
| `entity_type` | varchar(128) | NO | '' | MUL |
| `entity_id` | int(10) unsigned | NO | 0 | MUL |
| `uid` | int(10) unsigned | NO | 0 |  |
| `sid` | int(10) unsigned | NO | 0 |  |
| `timestamp` | int(10) unsigned | NO | 0 |  |

### `variable` — ~3,439 rows

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `name` | varchar(128) | NO | '' | PRI |
| `value` | longblob | NO | ~NULL~ |  |

## Full table census (818 tables, by approximate row count)

Approximate row counts from `information_schema` (InnoDB estimates). `field_revision_*` twins are census-listed but not detailed above.

| Table | Engine | ~Rows | Data MB | Index MB |
|---|---|---|---|---|
| `report_cache` | InnoDB | 15,685,308 | 24550.0 | 37246.1 |
| `taxonomy_index` | InnoDB | 12,776,141 | 547.0 | 560.7 |
| `field_revision_field_sirius_contact_tags` | InnoDB | 12,354,168 | 944.0 | 3039.9 |
| `field_data_field_sirius_contact_tags` | InnoDB | 12,289,151 | 908.0 | 2742.5 |
| `node` | InnoDB | 7,497,455 | 1333.0 | 2251.8 |
| `field_revision_field_sirius_domain` | InnoDB | 7,389,688 | 479.0 | 1562.5 |
| `field_data_field_sirius_domain` | InnoDB | 7,356,835 | 487.0 | 1395.1 |
| `node_revision` | InnoDB | 7,133,973 | 1082.0 | 542.2 |
| `field_data_field_sirius_date_start` | InnoDB | 6,520,633 | 439.0 | 1430.7 |
| `field_revision_field_sirius_date_start` | InnoDB | 6,484,842 | 439.0 | 1391.3 |
| `field_data_field_sirius_worker` | InnoDB | 6,483,395 | 431.0 | 1233.8 |
| `field_revision_field_sirius_worker` | InnoDB | 6,423,621 | 425.0 | 1378.2 |
| `field_revision_field_grievance_shop` | InnoDB | 5,611,076 | 374.0 | 1214.0 |
| `field_data_field_grievance_shop` | InnoDB | 5,605,029 | 380.0 | 1082.6 |
| `field_data_field_sirius_json` | InnoDB | 5,246,517 | 3826.0 | 1136.6 |
| `field_revision_field_sirius_json` | InnoDB | 4,998,040 | 3842.0 | 1102.2 |
| `field_revision_field_sirius_active` | InnoDB | 4,199,826 | 285.0 | 909.5 |
| `field_data_field_sirius_active` | InnoDB | 4,166,544 | 285.0 | 817.2 |
| `field_revision_field_sirius_date_end` | InnoDB | 3,975,366 | 273.0 | 864.5 |
| `field_data_field_sirius_date_end` | InnoDB | 3,951,439 | 273.0 | 777.2 |
| `sirius_hours_cache` | InnoDB | 3,342,280 | 429.0 | 353.1 |
| `field_data_field_sirius_datetime` | InnoDB | 2,933,596 | 197.9 | 580.8 |
| `field_data_field_sirius_datetime_completed` | InnoDB | 2,933,596 | 197.9 | 580.8 |
| `field_revision_field_sirius_datetime` | InnoDB | 2,933,596 | 197.9 | 645.0 |
| `field_revision_field_sirius_datetime_completed` | InnoDB | 2,933,596 | 197.9 | 645.0 |
| `sirius_trust_wb_scan_changelog` | InnoDB | 2,663,510 | 295.3 | 0.0 |
| `field_revision_field_sirius_notes` | InnoDB | 2,134,832 | 305.0 | 616.5 |
| `field_data_field_sirius_notes` | InnoDB | 1,885,070 | 171.8 | 435.3 |
| `field_revision_field_sirius_type` | InnoDB | 1,279,245 | 100.8 | 324.6 |
| `field_revision_field_sirius_trust_subscriber` | InnoDB | 1,186,804 | 113.9 | 338.8 |
| `field_data_field_sirius_category` | InnoDB | 1,121,441 | 78.7 | 212.0 |
| `field_data_field_sirius_type` | InnoDB | 1,074,679 | 72.7 | 213.0 |
| `field_revision_field_sirius_summary` | InnoDB | 1,072,126 | 197.0 | 285.3 |
| `field_revision_field_sirius_trust_benefit` | InnoDB | 1,060,046 | 115.8 | 340.8 |
| `field_data_field_sirius_message` | InnoDB | 1,040,504 | 163.8 | 212.0 |
| `field_revision_field_sirius_trust_election` | InnoDB | 903,516 | 104.8 | 308.6 |
| `field_revision_field_sirius_message` | InnoDB | 799,720 | 120.8 | 194.2 |
| `field_data_field_sirius_summary` | InnoDB | 739,150 | 116.7 | 142.9 |
| `field_revision_field_sirius_log_handler` | InnoDB | 721,266 | 45.6 | 170.0 |
| `field_data_field_sirius_log_handler` | InnoDB | 720,652 | 46.6 | 151.9 |
| `field_revision_field_sirius_category` | InnoDB | 712,659 | 51.6 | 161.0 |
| `field_data_field_sirius_trust_benefits` | InnoDB | 665,028 | 55.6 | 151.0 |
| `field_revision_field_sirius_trust_benefits` | InnoDB | 664,968 | 54.6 | 167.0 |
| `cache_field` | InnoDB | 623,265 | 2649.8 | 40.6 |
| `field_data_field_sirius_trust_benefit` | InnoDB | 607,020 | 48.6 | 137.0 |
| `field_data_field_sirius_trust_subscriber` | InnoDB | 599,578 | 48.6 | 149.9 |
| `field_revision_field_sirius_contact_relation` | InnoDB | 518,733 | 56.7 | 174.2 |
| `field_data_field_sirius_trust_election` | InnoDB | 506,729 | 46.6 | 137.0 |
| `field_revision_field_sirius_name` | InnoDB | 497,266 | 61.7 | 187.7 |
| `search_index` | InnoDB | 339,937 | 16.5 | 8.5 |
| `field_revision_field_sirius_denorm_benefits` | InnoDB | 329,364 | 46.6 | 132.0 |
| `field_data_field_sirius_contact_relation` | InnoDB | 312,018 | 28.6 | 79.7 |
| `field_revision_field_sirius_address` | InnoDB | 310,026 | 56.7 | 89.3 |
| `field_revision_field_sirius_address_canon` | InnoDB | 307,941 | 57.7 | 104.8 |
| `field_revision_field_sirius_phone` | InnoDB | 246,538 | 33.6 | 75.8 |
| `field_revision_field_sirius_contact` | InnoDB | 240,015 | 24.6 | 84.8 |
| `field_data_field_sirius_name` | InnoDB | 237,918 | 20.6 | 74.9 |
| `field_revision_field_sirius_address_county` | InnoDB | 227,957 | 36.6 | 76.8 |
| `field_revision_field_sirius_trust_policy` | InnoDB | 223,922 | 19.6 | 60.7 |
| `field_data_field_sirius_trust_policy` | InnoDB | 223,909 | 20.6 | 54.7 |
| `field_data_field_sirius_contact` | InnoDB | 209,495 | 14.5 | 48.7 |
| `field_revision_field_sirius_aat` | InnoDB | 185,617 | 22.6 | 74.8 |
| `field_revision_field_sirius_address_accuracy` | InnoDB | 185,125 | 31.6 | 76.8 |
| `field_revision_field_sirius_address_geo` | InnoDB | 179,099 | 65.7 | 218.6 |
| `field_revision_field_sirius_dispatch_medium` | InnoDB | 171,771 | 17.6 | 55.7 |
| `field_revision_field_sirius_id` | InnoDB | 168,221 | 20.6 | 60.7 |
| `field_revision_field_sirius_skills_availx` | InnoDB | 163,101 | 17.6 | 55.7 |
| `field_revision_field_sirius_gender_nota_calc` | InnoDB | 158,466 | 17.6 | 54.6 |
| `field_revision_field_sirius_source` | InnoDB | 156,980 | 27.6 | 60.7 |
| `field_data_field_sirius_aat` | InnoDB | 156,848 | 11.5 | 35.6 |
| `field_revision_field_sirius_ssn` | InnoDB | 155,376 | 19.6 | 54.6 |
| `field_data_field_sirius_denorm_benefits` | InnoDB | 147,900 | 13.5 | 44.9 |
| `field_revision_field_sirius_aat_required` | InnoDB | 144,889 | 17.6 | 55.7 |
| `field_revision_field_sirius_dispatch_eba` | InnoDB | 137,038 | 17.6 | 55.7 |
| `cache_menu` | InnoDB | 132,032 | 153.3 | 17.6 |
| `field_revision_field_sirius_email` | InnoDB | 130,721 | 20.6 | 44.6 |
| `field_data_field_sirius_id` | InnoDB | 125,564 | 9.5 | 39.6 |
| `field_revision_field_sirius_industry` | InnoDB | 123,165 | 13.5 | 39.6 |
| `field_data_field_sirius_address` | InnoDB | 116,584 | 16.5 | 34.1 |
| `field_data_field_sirius_address_canon` | InnoDB | 115,200 | 10.5 | 28.2 |
| `field_revision_field_sirius_member_status` | InnoDB | 114,906 | 12.5 | 39.6 |
| `field_revision_field_sirius_id3` | InnoDB | 114,777 | 14.5 | 40.6 |
| `field_data_field_sirius_gender_nota_calc` | InnoDB | 112,376 | 8.5 | 27.6 |
| `field_data_field_sirius_dispatch_eba` | InnoDB | 112,125 | 8.5 | 27.6 |
| `field_data_field_sirius_aat_required` | InnoDB | 112,103 | 8.5 | 27.6 |
| `field_data_field_sirius_ssn` | InnoDB | 112,038 | 9.5 | 36.2 |
| `field_data_field_sirius_skills_availx` | InnoDB | 112,014 | 8.5 | 27.6 |
| `field_data_field_sirius_dispatch_medium` | InnoDB | 111,881 | 8.5 | 27.6 |
| `sirius_ledger_ar` | InnoDB | 109,451 | 59.4 | 13.1 |
| `field_revision_field_sirius_dob` | InnoDB | 106,320 | 14.5 | 43.6 |
| `field_revision_field_sirius_gender` | InnoDB | 97,856 | 13.5 | 40.6 |
| `field_data_field_sirius_gender` | InnoDB | 79,423 | 6.5 | 25.6 |
| `field_data_field_sirius_id3` | InnoDB | 78,771 | 6.5 | 23.1 |
| `field_data_field_sirius_dob` | InnoDB | 72,524 | 6.5 | 23.6 |
| `field_data_field_sirius_phone` | InnoDB | 71,124 | 12.5 | 34.1 |
| `field_data_field_sirius_member_status` | InnoDB | 69,724 | 5.5 | 26.3 |
| `field_data_field_sirius_source` | InnoDB | 67,925 | 9.5 | 19.4 |
| `field_data_field_sirius_industry` | InnoDB | 65,287 | 5.5 | 26.4 |
| `field_data_field_sirius_trust_election_type` | InnoDB | 60,900 | 5.5 | 19.6 |
| `field_revision_field_sirius_trust_election_type` | InnoDB | 60,900 | 5.5 | 19.6 |
| `field_data_field_sirius_address_county` | InnoDB | 52,400 | 5.5 | 19.7 |
| `field_data_field_sirius_address_geo` | InnoDB | 50,090 | 12.5 | 52.3 |
| `field_data_field_sirius_email` | InnoDB | 49,816 | 6.5 | 18.5 |
| `field_data_field_sirius_address_accuracy` | InnoDB | 47,058 | 5.5 | 21.0 |
| `field_data_field_sirius_dispatch_job` | InnoDB | 43,296 | 3.5 | 11.6 |
| `field_data_field_sirius_dispatch_type` | InnoDB | 43,276 | 3.5 | 12.6 |
| `field_revision_field_sirius_dispatch_type` | InnoDB | 43,257 | 3.5 | 12.6 |
| `field_data_field_sirius_dispatch_cbn` | InnoDB | 43,250 | 3.5 | 11.6 |
| `field_revision_field_sirius_dispatch_cbn` | InnoDB | 43,250 | 3.5 | 11.6 |
| `field_revision_field_sirius_dispatch_job` | InnoDB | 43,250 | 3.5 | 11.6 |
| `field_data_field_sirius_dispatch_status` | InnoDB | 43,237 | 4.5 | 12.6 |
| `field_revision_field_sirius_dispatch_status` | InnoDB | 43,099 | 4.5 | 12.6 |
| `field_revision_field_sirius_id2` | InnoDB | 39,787 | 5.5 | 17.6 |
| `field_data_field_sirius_contact_alt` | InnoDB | 34,196 | 3.5 | 11.6 |
| `field_data_field_sirius_contact_reltype` | InnoDB | 34,196 | 3.5 | 11.6 |
| `field_data_field_sirius_count` | InnoDB | 34,196 | 3.5 | 10.1 |
| `field_revision_field_sirius_contact_reltype` | InnoDB | 34,196 | 3.5 | 11.6 |
| `field_revision_field_sirius_count` | InnoDB | 34,196 | 3.5 | 10.1 |
| `field_revision_field_sirius_contact_alt` | InnoDB | 34,067 | 3.5 | 11.6 |
| `field_data_field_sirius_id2` | InnoDB | 33,957 | 3.5 | 12.1 |
| `field_revision_field_sirius_payrate` | InnoDB | 29,897 | 3.5 | 9.9 |
| `field_data_field_sirius_contact_relations` | InnoDB | 29,488 | 3.5 | 12.1 |
| `field_revision_field_sirius_dispatch_asi` | InnoDB | 28,083 | 3.5 | 12.5 |
| `field_revision_field_sirius_contact_relations` | InnoDB | 25,132 | 2.5 | 11.6 |
| `field_data_field_sirius_payrate` | InnoDB | 20,977 | 1.5 | 8.7 |
| `field_data_field_sirius_dispatch_asi` | InnoDB | 20,573 | 1.5 | 6.3 |
| `field_data_field_sirius_fastload_status` | InnoDB | 20,027 | 2.5 | 6.4 |
| `field_revision_field_sirius_fastload_status` | InnoDB | 20,027 | 2.5 | 10.6 |
| `file_usage` | InnoDB | 14,955 | 1.5 | 2.3 |
| `field_data_field_sirius_attachments` | InnoDB | 12,316 | 1.5 | 4.0 |
| `queue` | InnoDB | 12,176 | 97.2 | 1.6 |
| `search_total` | InnoDB | 11,432 | 0.4 | 0.0 |
| `field_revision_field_sirius_dispatch_job_status` | InnoDB | 11,181 | 1.5 | 5.3 |
| `field_revision_field_sirius_dispatch_job_type` | InnoDB | 11,181 | 1.5 | 5.3 |
| `field_revision_field_sirius_count_yes` | InnoDB | 11,079 | 1.5 | 7.9 |
| `field_revision_field_sirius_ledger_account` | InnoDB | 10,871 | 1.5 | 5.4 |
| `field_revision_field_sirius_ledger_allocated` | InnoDB | 10,870 | 1.5 | 5.4 |
| `field_revision_field_sirius_dollar_amt` | InnoDB | 10,858 | 1.5 | 3.8 |
| `field_revision_field_sirius_payment_status` | InnoDB | 10,846 | 1.5 | 5.4 |
| `field_revision_field_sirius_payer` | InnoDB | 10,823 | 1.5 | 5.4 |
| `field_revision_field_sirius_payment_type` | InnoDB | 10,701 | 1.5 | 5.3 |
| `locales_source` | InnoDB | 10,414 | 1.5 | 0.6 |
| `field_revision_field_sirius_datetime_created` | InnoDB | 10,036 | 1.5 | 5.2 |
| `field_revision_field_sirius_lang` | InnoDB | 8,757 | 1.5 | 3.5 |
| `history` | InnoDB | 8,597 | 1.0 | 0.2 |
| `field_revision_field_sirius_attachments` | InnoDB | 8,147 | 1.5 | 3.9 |
| `field_revision_field_sirius_merchant_name` | InnoDB | 6,161 | 1.5 | 2.2 |
| `file_managed` | InnoDB | 5,665 | 1.5 | 2.3 |
| `field_revision_field_sirius_feed_status` | InnoDB | 5,224 | 1.5 | 2.0 |
| `search_dataset` | InnoDB | 4,881 | 5.5 | 0.0 |
| `field_revision_field_sirius_phone_alt` | InnoDB | 4,586 | 1.5 | 1.7 |
| `field_revision_field_sirius_check_number` | InnoDB | 4,064 | 1.5 | 1.6 |
| `field_revision_field_sirius_worker_dispstatus` | InnoDB | 3,830 | 0.3 | 1.2 |
| `field_data_field_sirius_feed_status` | InnoDB | 3,614 | 0.3 | 1.0 |
| `field_data_field_sirius_datetime_created` | InnoDB | 3,443 | 0.3 | 1.0 |
| `field_data_field_sirius_ledger_account` | InnoDB | 3,441 | 0.3 | 0.9 |
| `field_data_field_sirius_ledger_allocated` | InnoDB | 3,441 | 0.3 | 0.9 |
| `variable` | InnoDB | 3,439 | 0.5 | 0.0 |
| `field_data_field_sirius_payment_status` | InnoDB | 3,438 | 0.3 | 0.9 |
| `field_data_field_sirius_payment_type` | InnoDB | 3,438 | 0.3 | 0.9 |
| `field_data_field_sirius_dollar_amt` | InnoDB | 3,432 | 0.2 | 0.7 |
| `field_data_field_sirius_payer` | InnoDB | 3,401 | 0.3 | 0.9 |
| `users` | InnoDB | 3,286 | 1.5 | 0.8 |
| `fontyourface_tag_font` | InnoDB | 3,243 | 0.1 | 0.1 |
| `fontyourface_font` | InnoDB | 3,214 | 1.5 | 0.4 |
| `cache_geocoder` | InnoDB | 3,105 | 16.6 | 0.3 |
| `field_revision_field_sirius_sms_possible` | InnoDB | 2,689 | 0.2 | 0.7 |
| `field_revision_field_sirius_voice_possible` | InnoDB | 2,689 | 0.2 | 0.7 |
| `field_data_field_sirius_sms_possible` | InnoDB | 2,688 | 0.2 | 0.6 |
| `field_data_field_sirius_voice_possible` | InnoDB | 2,688 | 0.2 | 0.6 |
| `nodequeue_nodes` | InnoDB | 2,445 | 0.1 | 1.2 |
| `field_revision_field_sirius_gender_nota_val` | InnoDB | 2,278 | 0.3 | 0.9 |
| `users_roles` | InnoDB | 2,079 | 0.1 | 0.0 |
| `field_data_field_sirius_phone_alt` | InnoDB | 1,842 | 0.2 | 0.6 |
| `field_data_field_sirius_merchant_name` | InnoDB | 1,835 | 0.2 | 0.6 |
| `menu_router` | InnoDB | 1,681 | 1.3 | 0.6 |
| `menu_links` | InnoDB | 1,567 | 0.4 | 0.5 |
| `sirius_denorm_queue` | InnoDB | 1,455 | 0.1 | 0.2 |
| `registry` | InnoDB | 1,450 | 0.2 | 0.1 |
| `field_data_field_sirius_lang` | InnoDB | 1,329 | 0.2 | 0.5 |
| `field_data_field_sirius_check_number` | InnoDB | 1,205 | 0.1 | 0.5 |
| `cache_path` | InnoDB | 1,135 | 6.0 | 0.1 |
| `role_permission` | InnoDB | 1,068 | 0.1 | 0.1 |
| `s3fs_file` | InnoDB | 1,030 | 0.1 | 0.0 |
| `field_data_field_sirius_gender_nota_val` | InnoDB | 1,015 | 0.1 | 0.4 |
| `watchdog` | InnoDB | 1,000 | 1.0 | 0.1 |
| `registry_file` | InnoDB | 919 | 0.2 | 0.0 |
| `field_data_field_sirius_worker_dispstatus` | InnoDB | 814 | 0.1 | 0.3 |
| `field_data_field_grievance_shops` | InnoDB | 790 | 0.1 | 0.3 |
| `field_revision_field_grievance_shops` | InnoDB | 790 | 0.1 | 0.3 |
| `authmap` | InnoDB | 786 | 0.1 | 0.1 |
| `block` | InnoDB | 758 | 0.1 | 0.1 |
| `field_config_instance` | InnoDB | 736 | 1.5 | 0.1 |
| `sirius_ledger_balance` | InnoDB | 728 | 0.0 | 0.0 |
| `taxonomy_term_data` | InnoDB | 636 | 0.1 | 0.2 |
| `taxonomy_term_hierarchy` | InnoDB | 612 | 0.0 | 0.0 |
| `system` | InnoDB | 546 | 1.5 | 0.1 |
| `field_data_field_grievance_contact_types` | InnoDB | 525 | 0.1 | 0.1 |
| `field_revision_field_grievance_contact_types` | InnoDB | 525 | 0.1 | 0.2 |
| `field_revision_field_sirius_name_short` | InnoDB | 472 | 0.1 | 0.1 |
| `sirius_postal_lob_cache` | InnoDB | 460 | 14.6 | 0.0 |
| `field_revision_field_sirius_tz` | InnoDB | 453 | 0.1 | 0.2 |
| `field_revision_field_grievance_attachments` | InnoDB | 444 | 0.0 | 0.1 |
| `field_data_field_grievance_co_name` | InnoDB | 414 | 0.1 | 0.1 |
| `field_revision_field_grievance_co_name` | InnoDB | 414 | 0.1 | 0.1 |
| `field_data_field_grievance_co_email` | InnoDB | 410 | 0.1 | 0.1 |
| `field_revision_field_grievance_co_email` | InnoDB | 410 | 0.1 | 0.1 |
| `cache_views` | InnoDB | 333 | 11.5 | 0.1 |
| `field_data_field_grievance_co_role` | InnoDB | 328 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_role` | InnoDB | 328 | 0.0 | 0.1 |
| `field_revision_field_grievance_contract` | InnoDB | 321 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_job_status` | InnoDB | 319 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_job_type` | InnoDB | 319 | 0.0 | 0.1 |
| `field_revision_field_sirius_work_status` | InnoDB | 303 | 0.0 | 0.1 |
| `field_config` | InnoDB | 295 | 0.3 | 0.1 |
| `field_data_field_grievance_phone` | InnoDB | 290 | 0.0 | 0.1 |
| `field_revision_field_grievance_phone` | InnoDB | 290 | 0.0 | 0.1 |
| `field_data_field_sirius_count_yes` | InnoDB | 259 | 0.0 | 0.1 |
| `field_data_field_sirius_term_proxy` | InnoDB | 254 | 0.0 | 0.1 |
| `field_revision_field_sirius_term_proxy` | InnoDB | 254 | 0.0 | 0.1 |
| `field_revision_field_sirius_public` | InnoDB | 246 | 0.0 | 0.1 |
| `flagging` | InnoDB | 245 | 0.0 | 0.1 |
| `flag_counts` | InnoDB | 239 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_availdate` | InnoDB | 228 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_hfe_until` | InnoDB | 228 | 0.0 | 0.1 |
| `field_revision_field_sirius_skill_expire` | InnoDB | 228 | 0.0 | 0.1 |
| `node_comment_statistics` | InnoDB | 218 | 0.0 | 0.0 |
| `field_revision_field_sirius_paths` | InnoDB | 212 | 0.1 | 0.1 |
| `fieldset_helper_state_manager` | InnoDB | 211 | 0.0 | 0.0 |
| `field_data_field_sirius_paths` | InnoDB | 211 | 0.0 | 0.1 |
| `field_revision_body` | InnoDB | 191 | 2.5 | 0.1 |
| `pathauto_state` | InnoDB | 179 | 0.0 | 0.0 |
| `field_data_field_grievance_attachments` | InnoDB | 175 | 0.0 | 0.1 |
| `field_data_field_sirius_work_status` | InnoDB | 167 | 0.0 | 0.1 |
| `views_display` | InnoDB | 135 | 1.5 | 0.0 |
| `field_revision_field_sirius_bulk_medium` | InnoDB | 130 | 0.0 | 0.1 |
| `field_revision_field_sirius_bulk_status` | InnoDB | 130 | 0.0 | 0.1 |
| `l10n_update_project` | InnoDB | 124 | 0.0 | 0.0 |
| `field_data_field_grievance_contract` | InnoDB | 120 | 0.0 | 0.1 |
| `field_data_field_grievance_co_address` | InnoDB | 120 | 0.0 | 0.1 |
| `field_data_field_grievance_co_city` | InnoDB | 120 | 0.0 | 0.1 |
| `field_data_field_grievance_co_state` | InnoDB | 120 | 0.0 | 0.1 |
| `field_data_field_grievance_co_zip` | InnoDB | 120 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_address` | InnoDB | 120 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_city` | InnoDB | 120 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_state` | InnoDB | 120 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_zip` | InnoDB | 120 | 0.0 | 0.1 |
| `field_data_body` | InnoDB | 118 | 0.4 | 0.1 |
| `field_data_field_sirius_dispatch_availdate` | InnoDB | 116 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_hfe_until` | InnoDB | 115 | 0.0 | 0.1 |
| `field_data_field_sirius_skill_expire` | InnoDB | 115 | 0.0 | 0.1 |
| `field_data_field_grievance_co_phone` | InnoDB | 114 | 0.0 | 0.1 |
| `field_revision_field_sirius_phone_mobile` | InnoDB | 103 | 0.0 | 0.1 |
| `sessions` | InnoDB | 93 | 0.1 | 0.0 |
| `feeds_item` | InnoDB | 92 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_phone` | InnoDB | 81 | 0.0 | 0.1 |
| `i18n_string` | InnoDB | 79 | 0.0 | 0.0 |
| `url_alias` | InnoDB | 77 | 0.0 | 0.0 |
| `views_view` | InnoDB | 63 | 0.0 | 0.0 |
| `search_node_links` | InnoDB | 62 | 0.0 | 0.0 |
| `node_type` | InnoDB | 57 | 0.0 | 0.0 |
| `taxonomy_vocabulary` | InnoDB | 47 | 0.0 | 0.0 |
| `field_data_field_sirius_bulk_status` | InnoDB | 44 | 0.0 | 0.1 |
| `field_data_field_sirius_bulk_medium` | InnoDB | 43 | 0.0 | 0.1 |
| `date_formats` | InnoDB | 38 | 0.0 | 0.0 |
| `features_signature` | InnoDB | 38 | 0.0 | 0.0 |
| `field_data_field_sirius_content_types` | InnoDB | 38 | 0.0 | 0.1 |
| `field_revision_field_sirius_content_types` | InnoDB | 38 | 0.0 | 0.1 |
| `field_data_field_grievance_can_attach` | InnoDB | 37 | 0.0 | 0.1 |
| `field_revision_field_grievance_can_attach` | InnoDB | 37 | 0.0 | 0.1 |
| `cache` | InnoDB | 34 | 3.5 | 0.0 |
| `field_data_field_sirius_roles` | InnoDB | 32 | 0.0 | 0.1 |
| `field_revision_field_sirius_roles` | InnoDB | 32 | 0.0 | 0.1 |
| `field_data_field_sirius_event_proles` | InnoDB | 31 | 0.0 | 0.1 |
| `field_revision_field_sirius_event_proles` | InnoDB | 31 | 0.0 | 0.1 |
| `filter` | InnoDB | 30 | 0.0 | 0.0 |
| `tfa_recovery_code` | InnoDB | 30 | 0.0 | 0.0 |
| `actions` | InnoDB | 29 | 0.0 | 0.0 |
| `elysia_cron` | InnoDB | 28 | 0.0 | 0.0 |
| `field_revision_field_sirius_trust_benefit_type` | InnoDB | 28 | 0.0 | 0.1 |
| `field_data_field_sirius_phone_mobile` | InnoDB | 25 | 0.0 | 0.1 |
| `field_data_field_sirius_sms` | InnoDB | 23 | 0.0 | 0.1 |
| `field_revision_field_sirius_sms` | InnoDB | 23 | 0.0 | 0.1 |
| `field_data_field_grievance_co_phone_2` | InnoDB | 20 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_available` | InnoDB | 20 | 0.0 | 0.1 |
| `field_data_field_sirius_trust_benefit_type` | InnoDB | 20 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_phone_2` | InnoDB | 20 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_available` | InnoDB | 20 | 0.0 | 0.1 |
| `draggableviews_structure` | InnoDB | 19 | 0.0 | 0.0 |
| `batch` | InnoDB | 18 | 3.0 | 0.0 |
| `field_revision_field_sirius_letter_content_type` | InnoDB | 18 | 0.0 | 0.1 |
| `field_data_field_sirius_badge` | InnoDB | 17 | 0.0 | 0.1 |
| `field_data_field_sirius_name_display` | InnoDB | 17 | 0.0 | 0.1 |
| `field_data_field_sirius_name_short` | InnoDB | 17 | 0.0 | 0.1 |
| `field_revision_field_grievance_description` | InnoDB | 17 | 0.0 | 0.1 |
| `field_revision_field_grievance_external_id` | InnoDB | 17 | 0.0 | 0.1 |
| `field_revision_field_sirius_badge` | InnoDB | 17 | 0.0 | 0.1 |
| `field_revision_field_sirius_currency` | InnoDB | 17 | 0.0 | 0.1 |
| `field_revision_field_sirius_name_display` | InnoDB | 17 | 0.0 | 0.1 |
| `fontyourface_tag` | InnoDB | 16 | 0.0 | 0.0 |
| `imagefield_crop` | InnoDB | 16 | 0.0 | 0.0 |
| `field_data_field_grievance_description` | InnoDB | 15 | 0.0 | 0.1 |
| `field_data_field_sirius_member_active` | InnoDB | 14 | 0.0 | 0.1 |
| `field_revision_field_sirius_member_active` | InnoDB | 14 | 0.0 | 0.1 |
| `block_role` | InnoDB | 13 | 0.0 | 0.0 |
| `feeds_importer` | InnoDB | 13 | 0.0 | 0.0 |
| `feeds_source` | InnoDB | 13 | 0.0 | 0.0 |
| `field_data_field_grievance_actor` | InnoDB | 13 | 0.0 | 0.1 |
| `field_data_field_sirius_letter_content_type` | InnoDB | 13 | 0.0 | 0.1 |
| `field_revision_field_grievance_actor` | InnoDB | 13 | 0.0 | 0.1 |
| `field_group` | InnoDB | 12 | 0.0 | 0.0 |
| `front_page` | InnoDB | 12 | 0.0 | 0.0 |
| `menu_custom` | InnoDB | 12 | 0.0 | 0.0 |
| `role` | InnoDB | 12 | 0.0 | 0.0 |
| `field_data_field_sirius_emails` | InnoDB | 11 | 0.0 | 0.1 |
| `field_data_field_sirius_term_source` | InnoDB | 11 | 0.0 | 0.1 |
| `field_revision_field_grievance_update_rep` | InnoDB | 11 | 0.0 | 0.1 |
| `field_revision_field_sirius_emails` | InnoDB | 11 | 0.0 | 0.1 |
| `field_revision_field_sirius_mustlog` | InnoDB | 11 | 0.0 | 0.1 |
| `field_revision_field_sirius_term_source` | InnoDB | 11 | 0.0 | 0.1 |
| `field_data_field_sirius_name_alt` | InnoDB | 10 | 0.0 | 0.1 |
| `field_revision_field_sirius_name_alt` | InnoDB | 10 | 0.0 | 0.1 |
| `field_data_field_grievance_external_id` | InnoDB | 9 | 0.0 | 0.1 |
| `field_revision_field_grievance_shortname` | InnoDB | 9 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_job_types` | InnoDB | 9 | 0.0 | 0.1 |
| `field_data_field_grievance_update_rep` | InnoDB | 8 | 0.0 | 0.1 |
| `field_data_field_sirius_mustlog` | InnoDB | 8 | 0.0 | 0.1 |
| `field_data_field_grievance_can_ir` | InnoDB | 7 | 0.0 | 0.1 |
| `field_data_field_grievance_days` | InnoDB | 7 | 0.0 | 0.1 |
| `field_data_field_grievance_notify_body` | InnoDB | 7 | 0.1 | 0.1 |
| `field_data_field_sirius_dispatch_job_types` | InnoDB | 7 | 0.0 | 0.1 |
| `field_data_field_sirius_public` | InnoDB | 7 | 0.0 | 0.1 |
| `field_revision_field_grievance_can_ir` | InnoDB | 7 | 0.0 | 0.1 |
| `field_revision_field_grievance_days` | InnoDB | 7 | 0.0 | 0.1 |
| `field_revision_field_grievance_notify_body` | InnoDB | 7 | 0.1 | 0.1 |
| `custom_help_text_roles` | InnoDB | 6 | 0.0 | 0.0 |
| `date_format_type` | InnoDB | 6 | 0.0 | 0.0 |
| `field_data_field_grievance_bundle` | InnoDB | 6 | 0.0 | 0.1 |
| `field_data_field_grievance_co_fax` | InnoDB | 6 | 0.0 | 0.1 |
| `field_data_field_grievance_entity_type` | InnoDB | 6 | 0.0 | 0.1 |
| `field_data_field_grievance_field_name` | InnoDB | 6 | 0.0 | 0.1 |
| `field_data_field_grievance_label` | InnoDB | 6 | 0.0 | 0.1 |
| `field_data_field_grievance_notify_subject` | InnoDB | 6 | 0.0 | 0.1 |
| `field_data_field_grievance_roles` | InnoDB | 6 | 0.0 | 0.1 |
| `field_data_field_grievance_shortname` | InnoDB | 6 | 0.0 | 0.1 |
| `field_data_field_sirius_css_class` | InnoDB | 6 | 0.0 | 0.1 |
| `field_revision_field_grievance_bundle` | InnoDB | 6 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_fax` | InnoDB | 6 | 0.0 | 0.1 |
| `field_revision_field_grievance_entity_type` | InnoDB | 6 | 0.0 | 0.1 |
| `field_revision_field_grievance_field_name` | InnoDB | 6 | 0.0 | 0.1 |
| `field_revision_field_grievance_label` | InnoDB | 6 | 0.0 | 0.1 |
| `field_revision_field_grievance_notify_subject` | InnoDB | 6 | 0.0 | 0.1 |
| `field_revision_field_grievance_roles` | InnoDB | 6 | 0.0 | 0.1 |
| `field_revision_field_sirius_css_class` | InnoDB | 6 | 0.0 | 0.1 |
| `field_validation_rule` | InnoDB | 6 | 0.0 | 0.0 |
| `cache_bootstrap` | InnoDB | 5 | 2.0 | 0.0 |
| `field_data_field_grievance_images` | InnoDB | 5 | 0.0 | 0.1 |
| `field_data_field_sirius_boolean` | InnoDB | 5 | 0.0 | 0.1 |
| `field_revision_field_grievance_images` | InnoDB | 5 | 0.0 | 0.1 |
| `field_revision_field_sirius_boolean` | InnoDB | 5 | 0.0 | 0.1 |
| `filter_format` | InnoDB | 5 | 0.0 | 0.0 |
| `name_custom_format` | InnoDB | 5 | 0.0 | 0.0 |
| `print_page_counter` | InnoDB | 5 | 0.0 | 0.0 |
| `print_pdf_page_counter` | InnoDB | 5 | 0.0 | 0.0 |
| `ckeditor_settings` | InnoDB | 4 | 0.0 | 0.0 |
| `field_data_field_sirius_notify` | InnoDB | 4 | 0.0 | 0.1 |
| `field_revision_field_sirius_notify` | InnoDB | 4 | 0.0 | 0.1 |
| `ckeditor_input_format` | InnoDB | 3 | 0.0 | 0.0 |
| `comment` | InnoDB | 3 | 0.0 | 0.1 |
| `field_data_comment_body` | InnoDB | 3 | 0.0 | 0.1 |
| `field_data_field_grievance_company` | InnoDB | 3 | 0.0 | 0.1 |
| `field_data_field_grievance_open` | InnoDB | 3 | 0.0 | 0.1 |
| `field_data_field_grievance_phone_off` | InnoDB | 3 | 0.0 | 0.1 |
| `field_data_field_sirius_currency` | InnoDB | 3 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_facility` | InnoDB | 3 | 0.0 | 0.1 |
| `field_revision_comment_body` | InnoDB | 3 | 0.0 | 0.1 |
| `field_revision_field_grievance_company` | InnoDB | 3 | 0.0 | 0.1 |
| `field_revision_field_grievance_open` | InnoDB | 3 | 0.0 | 0.1 |
| `field_revision_field_grievance_phone_off` | InnoDB | 3 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_facility` | InnoDB | 3 | 0.0 | 0.1 |
| `field_revision_field_sirius_rawhtml` | InnoDB | 3 | 0.0 | 0.1 |
| `tfa_user_settings` | InnoDB | 3 | 0.0 | 0.0 |
| `cache_features` | InnoDB | 2 | 1.5 | 0.0 |
| `cache_libraries` | InnoDB | 2 | 0.0 | 0.0 |
| `cache_token` | InnoDB | 2 | 0.3 | 0.0 |
| `cache_variable` | InnoDB | 2 | 0.1 | 0.0 |
| `conditional_fields` | InnoDB | 2 | 0.0 | 0.0 |
| `field_data_field_grievance_annual` | InnoDB | 2 | 0.0 | 0.1 |
| `field_data_field_grievance_date` | InnoDB | 2 | 0.0 | 0.1 |
| `field_data_field_grievance_tags` | InnoDB | 2 | 0.0 | 0.1 |
| `field_data_field_grievance_timeline_show` | InnoDB | 2 | 0.0 | 0.1 |
| `field_data_field_sirius_headshot` | InnoDB | 2 | 0.0 | 0.1 |
| `field_data_field_sirius_name_tts` | InnoDB | 2 | 0.0 | 0.1 |
| `field_data_field_sirius_signature` | InnoDB | 2 | 0.0 | 0.1 |
| `field_revision_field_grievance_annual` | InnoDB | 2 | 0.0 | 0.1 |
| `field_revision_field_grievance_date` | InnoDB | 2 | 0.0 | 0.1 |
| `field_revision_field_grievance_tags` | InnoDB | 2 | 0.0 | 0.1 |
| `field_revision_field_grievance_timeline_show` | InnoDB | 2 | 0.0 | 0.1 |
| `field_revision_field_sirius_headshot` | InnoDB | 2 | 0.0 | 0.1 |
| `field_revision_field_sirius_name_tts` | InnoDB | 2 | 0.0 | 0.1 |
| `field_revision_field_sirius_signature` | InnoDB | 2 | 0.0 | 0.1 |
| `image_effects` | InnoDB | 2 | 0.0 | 0.0 |
| `image_styles` | InnoDB | 2 | 0.0 | 0.0 |
| `rdf_mapping` | InnoDB | 2 | 0.0 | 0.0 |
| `variable_store` | InnoDB | 2 | 0.0 | 0.0 |
| `backup_migrate_destinations` | InnoDB | 1 | 0.0 | 0.0 |
| `backup_migrate_schedules` | InnoDB | 1 | 0.0 | 0.0 |
| `block_custom` | InnoDB | 1 | 0.0 | 0.0 |
| `block_node_type` | InnoDB | 1 | 0.0 | 0.0 |
| `ds_layout_settings` | InnoDB | 1 | 0.0 | 0.0 |
| `ds_view_modes` | InnoDB | 1 | 0.0 | 0.0 |
| `environment_indicator_environment` | InnoDB | 1 | 0.0 | 0.0 |
| `field_data_field_grievance_comments` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_grievance_co_address_2` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_sirius_address_notes` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_eba_dates` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_job_group` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_job_nfcns` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_sirius_nota` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_sirius_payperiod_type` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_sirius_tz` | InnoDB | 1 | 0.0 | 0.1 |
| `field_data_field_sirius_voice` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_grievance_comments` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_grievance_co_address_2` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_sirius_address_notes` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_eba_dates` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_job_group` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_job_nfcns` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_sirius_nota` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_sirius_payperiod_type` | InnoDB | 1 | 0.0 | 0.1 |
| `field_revision_field_sirius_voice` | InnoDB | 1 | 0.0 | 0.1 |
| `flag` | InnoDB | 1 | 0.0 | 0.0 |
| `languages` | InnoDB | 1 | 0.0 | 0.0 |
| `login_destination` | InnoDB | 1 | 0.0 | 0.0 |
| `nodequeue_queue` | InnoDB | 1 | 0.0 | 0.0 |
| `nodequeue_subqueue` | InnoDB | 1 | 0.0 | 0.0 |
| `nodequeue_types` | InnoDB | 1 | 0.0 | 0.0 |
| `node_access` | InnoDB | 1 | 0.0 | 0.0 |
| `sequences` | InnoDB | 1 | 0.0 | 0.0 |
| `services_endpoint` | InnoDB | 1 | 0.0 | 0.0 |
| `shortcut_set` | InnoDB | 1 | 0.0 | 0.0 |
| `sirius_quickhash` | InnoDB | 1 | 0.0 | 0.0 |
| `tfa_totp_seed` | InnoDB | 1 | 0.0 | 0.0 |
| `views_data_export_object_cache` | InnoDB | 1 | 61.0 | 0.0 |
| `views_savedsearches` | InnoDB | 1 | 0.0 | 0.0 |
| `backup_migrate_profiles` | InnoDB | 0 | 0.0 | 0.0 |
| `backup_migrate_sources` | InnoDB | 0 | 0.0 | 0.0 |
| `blocked_ips` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_admin_menu` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_admin_menu__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_block` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_bootstrap__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_features__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_feeds_http` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_field__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_filter` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_filter__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_form` | InnoDB | 0 | 6.0 | 0.0 |
| `cache_image` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_libraries__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_page` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_page__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_path__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_rules` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_shorten` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_token__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_update` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_update__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_variable__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_views_data` | InnoDB | 0 | 0.0 | 0.0 |
| `cache_views__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `cache__truncated_table` | InnoDB | 0 | 0.0 | 0.0 |
| `ctools_css_cache` | InnoDB | 0 | 0.0 | 0.0 |
| `ctools_object_cache` | InnoDB | 0 | 0.0 | 0.0 |
| `date_format_locale` | InnoDB | 0 | 0.0 | 0.0 |
| `ds_fields` | InnoDB | 0 | 0.0 | 0.0 |
| `ds_field_settings` | InnoDB | 0 | 0.0 | 0.0 |
| `ds_vd` | InnoDB | 0 | 0.0 | 0.0 |
| `feeds_log` | InnoDB | 0 | 0.0 | 0.1 |
| `feeds_push_subscriptions` | InnoDB | 0 | 0.0 | 0.0 |
| `field_data_field_field_grievance_resproc_ua` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_file_image_alt_text` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_file_image_title_text` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_address` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_address_2` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_alert` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_alert_date` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_alert_tid` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_alert_waived` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_amt` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_amt_rcvd` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_arbitration_a` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_arbitration_b` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_arbitration_c` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_arbitration_d` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_artsel` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_assignee_notes` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_broughtby` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_category` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_chapter` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_checkno` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_city` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_classaction` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_classification` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_classifications` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_class_tid` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_clause` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_clauseref` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_contact_selector` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_contract_section` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_contract_tplt` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_contract_tplts` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_cont_sec_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_cont_tplt_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_corrected` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_css` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_data_alert` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_date_1` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_date_2` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_daysoff` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_days_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_default` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_department` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_departments` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_department_tid` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_document_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_document_types` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_dummy` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_ein` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_email` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_emails` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_emp_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_first_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_from_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_gender` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_hidefields` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_hire_date` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_holidays` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_id` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_inforeq` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_last_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_log_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_log_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_meeting_date` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_min` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_next_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_outcome` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_pullclause` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_remedy` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_remedy_other` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_rep_assignee` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_rep_filed` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_rep_lead` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_rep_manager` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_rep_organizer` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_rep_watching` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_resproc` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_resproc_an` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_resproc_cd` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_resproc_ea` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_resproc_er` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_resproc_hd` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_resproc_lh` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_resproc_ur` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_section_number` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_settlement_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_shift` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_state` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_statuses` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_status_date` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_st_email` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_st_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_st_phone` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_st_selector` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_supervisor_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_supervisor_title` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_supervisor_unit` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_type_other` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_valid` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_violation` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_weight` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_work_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievance_zip` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_grievanct_cont_clse_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_address_parking` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_audio` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_audio_public` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_batch_max` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_batch_min` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_batch_ratio` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_bu` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_callerids` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_count_no` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_count_notified` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_daterepeat` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_denorm_level` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_3sen` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_days` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_dncs` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_dncs2` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_hall` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_hfe` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_job_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_roles` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_dispatch_sib_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_docret_key` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_docret_mode` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_edls_sheet_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_email_possible` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_event` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_events` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_event_prole` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_event_pstatus` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_event_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_hour_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_job_number` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_json_definition` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_ledger_category` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_letterhead_format` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_log` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_page` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_payrate_skilled` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_phone_fax` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_provider_npi` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_rawhtml` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_representatives` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_skill` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_skills_avail` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_timelimit` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_title` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_trust_prov_levels` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_trust_service_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_data_field_sirius_users` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_field_grievance_resproc_ua` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_file_image_alt_text` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_file_image_title_text` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_address` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_address_2` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_alert` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_alert_date` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_alert_tid` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_alert_waived` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_amt` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_amt_rcvd` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_arbitration_a` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_arbitration_b` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_arbitration_c` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_arbitration_d` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_artsel` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_assignee_notes` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_broughtby` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_category` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_chapter` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_checkno` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_city` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_classaction` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_classification` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_classifications` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_class_tid` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_clause` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_clauseref` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_contact_selector` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_contract_section` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_contract_tplt` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_contract_tplts` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_cont_sec_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_cont_tplt_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_corrected` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_css` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_data_alert` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_date_1` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_date_2` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_daysoff` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_days_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_default` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_department` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_departments` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_department_tid` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_document_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_document_types` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_dummy` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_ein` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_email` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_emails` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_emp_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_first_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_from_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_gender` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_hidefields` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_hire_date` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_holidays` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_id` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_inforeq` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_last_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_log_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_log_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_meeting_date` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_min` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_next_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_outcome` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_pullclause` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_remedy` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_remedy_other` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_rep_assignee` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_rep_filed` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_rep_lead` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_rep_manager` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_rep_organizer` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_rep_watching` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_resproc` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_resproc_an` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_resproc_cd` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_resproc_ea` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_resproc_er` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_resproc_hd` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_resproc_lh` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_resproc_ur` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_section_number` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_settlement_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_shift` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_state` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_statuses` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_status_date` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_st_email` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_st_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_st_phone` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_st_selector` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_supervisor_name` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_supervisor_title` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_supervisor_unit` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_type_other` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_valid` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_violation` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_weight` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_work_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievance_zip` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_grievanct_cont_clse_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_address_parking` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_audio` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_audio_public` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_batch_max` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_batch_min` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_batch_ratio` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_bu` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_callerids` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_count_no` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_count_notified` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_daterepeat` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_denorm_level` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_3sen` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_days` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_dncs` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_dncs2` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_hall` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_hfe` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_job_tags` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_roles` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_dispatch_sib_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_docret_key` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_docret_mode` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_edls_sheet_status` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_email_possible` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_event` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_events` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_event_prole` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_event_pstatus` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_event_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_hour_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_job_number` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_json_definition` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_ledger_category` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_letterhead_format` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_log` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_page` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_payrate_skilled` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_phone_fax` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_provider_npi` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_representatives` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_skill` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_skills_avail` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_timelimit` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_title` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_trust_prov_levels` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_trust_service_type` | InnoDB | 0 | 0.0 | 0.1 |
| `field_revision_field_sirius_users` | InnoDB | 0 | 0.0 | 0.1 |
| `flag_types` | InnoDB | 0 | 0.0 | 0.0 |
| `flood` | InnoDB | 0 | 0.0 | 0.0 |
| `i18n_block_language` | InnoDB | 0 | 0.0 | 0.0 |
| `i18n_path` | InnoDB | 0 | 0.0 | 0.0 |
| `i18n_translation_set` | InnoDB | 0 | 0.0 | 0.0 |
| `job_schedule` | InnoDB | 0 | 0.0 | 0.1 |
| `l10n_update_file` | InnoDB | 0 | 0.0 | 0.0 |
| `locales_target` | InnoDB | 0 | 0.0 | 0.0 |
| `masquerade` | InnoDB | 0 | 0.0 | 0.0 |
| `masquerade_users` | InnoDB | 0 | 0.0 | 0.0 |
| `nodequeue_roles` | InnoDB | 0 | 0.0 | 0.0 |
| `print_node_conf` | InnoDB | 0 | 0.0 | 0.0 |
| `print_pdf_node_conf` | InnoDB | 0 | 0.0 | 0.0 |
| `rules_config` | InnoDB | 0 | 0.0 | 0.0 |
| `rules_dependencies` | InnoDB | 0 | 0.0 | 0.0 |
| `rules_tags` | InnoDB | 0 | 0.0 | 0.0 |
| `rules_trigger` | InnoDB | 0 | 0.0 | 0.0 |
| `semaphore` | InnoDB | 0 | 0.0 | 0.0 |
| `services_user` | InnoDB | 0 | 0.0 | 0.0 |
| `shortcut_set_users` | InnoDB | 0 | 0.0 | 0.0 |
| `sirius_dispatch_elig_cache` | InnoDB | 0 | 0.0 | 0.0 |
| `sirius_lock` | InnoDB | 0 | 0.0 | 0.0 |
| `sirius_sched` | InnoDB | 0 | 0.0 | 0.1 |
| `tfa_accepted_code` | InnoDB | 0 | 0.0 | 0.0 |
| `tfa_trusted_browser` | InnoDB | 0 | 0.0 | 0.0 |
| `views_calc_fields` | InnoDB | 0 | 0.0 | 0.0 |
| `views_data_export` | InnoDB | 0 | 0.0 | 0.0 |
