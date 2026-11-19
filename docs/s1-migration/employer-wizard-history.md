# Data Migration: Employer Wizards

## Status: source-authority gate blocked

The approved destination is **actual S2 wizard records**, not historical
placeholders. No importer or application behavior has been changed yet.
Implementation must wait for authoritative source evidence; this document
is not an approved type/status mapping or a completed migration report.

### Representation contract

- Preserve the real supported S2 upload type, employer, reporting year/month,
  source chronology, and evidence-backed status.
- Retain original source identity and original type/status values for traceability.
- Historical file bytes are unavailable in S2. Do not create attachments,
  external retrieval links, completed steps, or processing results.
- Opening history must explain file unavailability without changing its status.
  Neither the UI nor server endpoints may resume, process, download, or rerun it.
- Do not reprocess hours, generate financial records, or send upload-completion
  notifications. Native S2 uploads must retain their ordinary behavior.
- CLI execution remains under the existing S1 Migration Oneoff ownership
  boundary; its dashboard remains read-only.

## Available evidence

The checked-in production **structure and aggregate profile**, not a current
record-level inspection, establishes these candidate sources:

| Source | Observed evidence | What it does not establish |
|---|---|---|
| `node.type = 'sirius_feed'` | Historical census: 3,684 nodes; `nid`, `vid`, `created`, `changed`, publication `status` are available | Which nodes represent employer upload attempts; node publication status is not upload status |
| `field_sirius_type` | 3,684 live field rows on `sirius_feed`; text value plus format | Exact type values and their S2 equivalents |
| `field_sirius_feed_status` | 3,684 live field rows on `sirius_feed`; text value | Complete status vocabulary, transitions, or whether `complete` means successful processing |
| `field_grievance_shop` | 3,226 live field rows on `sirius_feed` | Whether every eligible attempt has exactly one valid employer, including language/delta anomalies |
| `field_sirius_json` | 3,541 live field rows on `sirius_feed` | Reporting-period keys, payload versions, result semantics, or sensitive contents |
| `field_sirius_attachments` | 3,861 live field rows; multiple deltas occur | File availability in S2 or a one-to-one relationship between attachment and attempt |
| `field_sirius_domain` | 3,681 live field rows | Whether domain limits the eligible upload set |
| `feeds_source` | Composite identity `(id, feed_nid)`; configuration, source, state, fetch result, imported timestamp | Whether this Drupal Feeds subsystem records the same attempts as `sirius_feed` |
| `feeds_item` | Entity identity, importer id, `feed_nid`, imported timestamp, URL/GUID/hash | An upload's type, reporting month, completion status, or one row per attempt |
| `sirius_employer_payperiod` | Prior inspection: auto-created monthly workflow envelopes, occasionally duplicated, no inbound references | Evidence that an upload occurred or succeeded |

Sources: `01-field-inventory.md`, `profile/fielddata_stats.tsv`,
`profile/columns.tsv`, `s1-schema.sql`, and
[`../n3-employer-payperiod-drop.md`](../n3-employer-payperiod-drop.md).
Field-row counts are not distinct-attempt counts. The old mapping's
`complete/draft` wording is not a verified exhaustive status census.

## Operator-supplied real-source inventory (2026-11-19)

The operator ran Q1–Q8 in Beekeeper and supplied sanitized results. These
establish a live-source inventory, **not yet a source-to-S2 comparison**:

- MariaDB 10.6.25; session and system timezones UTC. This does not establish
  the timezone of serialized date values or the intended reporting month.
- 4,695 `sirius_feed` nodes and 18,945 `sirius_employer_payperiod` nodes.
  All are published; publication is not processing completion.
- All feeds have exactly one live type field and one live status field.
  The observed statuses are `complete` and `draft`. Q4 totals reconcile to
  the feed-node census (4,695).
- Candidate `sirius_smf_feed_ehrs`: 2,591 nodes (2,563 complete, 28 draft);
  2,453 valid shop targets, 2 missing references, 136 missing target nodes.
- Candidate `sirius_smf_feed_ehrs_correction`: 1,725 nodes (1,437 complete,
  288 draft); 1,565 valid shop targets, 158 missing references, 2 missing
  target nodes. Neither source type is yet approved for an S2 type mapping.
- The two candidates total 4,316 nodes, with 4,018 valid shop targets,
  160 missing references, and 138 missing target nodes. Do not substitute
  today's employer or infer a missing link from hours.
- Other source types total 379 nodes. These include `feed_hours`,
  `feed_employee`, worker/benefit/payment feeds, and anomalous types such as
  `complete`. They require explicit classification, not blanket import.
- The 4,176 employer-reference rows and all observed type/status/JSON rows
  use `und`, delta 0. There are 4,536 JSON field rows, all objects, each
  with exactly the top-level key `wizard`. 159 feeds lack that JSON field.
- Q3 declares no direct reporting-period field on `sirius_feed`. It **does**
  declare a JSON field on `sirius_employer_payperiod`, contrary to the old
  N3 description of its shape. Declaration does not prove populated data;
  this is another reason not to treat that old description as exhaustive.
- Q8 reports 13 `feeds_source` rows and 92 `feeds_item` rows, all with
  `feed_nid=0` and no matching node. The supplied current snapshot therefore
  provides no linkage from these tables to `sirius_feed` attempts.

Next run
[`s1-employer-wizard-json-structure.sql`](../../scripts/oneoffs/s1-employer-wizard-json-structure.sql)
for Q9–Q11: account for missing JSON by type/status and discover only key
names/shapes under `wizard` and its immediate object children. No raw values
or arrays of uploaded rows are returned. Review key names before sharing.
The pack is not yet executed against S1 here. Period extraction, completion
semantics, retry identity, and correction-type correspondence remain open.

## Reconciliation of previous DROP decisions

The blanket `sirius_feed`/`feeds_*` DROP decision is **reopened for employer
upload history only**. It does not authorize importing unrelated feeds.

N3's observation that employer-period trackers are auto-created remains useful.
Its argument that migrated hours prove upload history is insufficient:
hours do not establish upload type, attempt, or status. Do not convert those
envelopes into completed wizards. The existing counted staging skip remains
unchanged until source evidence justifies a specific replacement.

## Required protected-environment source inspection

For the first read-only Beekeeper pass, use
[`s1-employer-wizard-source-inventory.sql`](../../scripts/oneoffs/s1-employer-wizard-source-inventory.sql).
Run its labeled Q1–Q8 queries on one connection and review the results before
sharing. It returns aggregates and field/key names, not raw payloads. Type,
status, importer identifiers, and JSON key names are source-authored: redact
unexpected sensitive strings. Q7 is capped at 100 keys; a full result at that
limit is not proof that all keys were inventoried. This pack has been checked
against the checked-in source schema but has not been executed against S1 here.
It intentionally defers record-level/period queries until actual key names and
types are known; it cannot establish status semantics without S1 behavior evidence.

An authorized operator must inspect the real source read-only inside the
HIPAA boundary. Do not copy raw JSON, file paths, names, credentials, or other
personal data into this workspace. Return sanitized aggregate findings and
the explicit mapping decisions; retain record-level evidence inside the boundary.

1. Read the Drupal field catalog for `sirius_feed`, including field types,
   cardinalities, allowed-value configuration, and actual field-table columns.
   Account for deleted rows, languages, extra deltas, and missing fields.
2. Census exact upload type/status combinations. Inspect the S1 code that
   creates attempts and changes their statuses, distinguishing publication
   state, validation completion, processing completion, and failure.
3. Establish the employer relationship and exact reporting-period source,
   including JSON versions if relevant. Prove month semantics at December/
   January boundaries; never substitute creation month or infer from hours.
4. Establish which timestamp orders attempts and its timezone. Determine
   whether one node changes across retries or each attempt receives a new
   node, and whether revisions or another source retain earlier attempts.
5. Check whether `feeds_source`/`feeds_item` belong to the relevant workflow
   before deciding to stage them. Do not treat output items as upload attempts.
6. Revisit representative period trackers against actual upload evidence,
   including duplicate envelopes. Report missing, ambiguous, unrelated,
   unsupported, and valid cases separately with uncapped totals and bounded
   identifier-only samples.
7. Supply an explicit source-type → S2-type and source-status → S2-status
   mapping, with employer/period/timestamp extraction rules and duplicate
   handling. Unknown evidence must be rejected and counted, not mapped to
   completed.

## Run order and verification: not yet authorized or performed

After source authority is resolved, stage the approved history, load its
employer and supported-type prerequisites, then run the source-keyed importer.
Parent wizard, monthly association, and identity bookkeeping must commit
consistently. Reruns must preserve identity and refuse unrelated native targets.
Register the importer in the ordered sync, result, and verification contracts.

Acceptance still requires a bounded dry run and authorized rehearsal against
real source evidence, followed by exact source/destination comparisons through
the compliance storage query and authenticated report. Cover available types/
statuses, month boundaries, multiple attempts, report links, and native/
migrated coexistence. Record before/after hours and financial totals and
repeat-run identity proof. No permanent conversion-test suite is requested.

### Current reconciliation results and limits

- Current real-source comparisons: **not performed**.
- Real-source inventory: Q1–Q8 supplied by the authorized operator; see above.
- Approved type/status/period mapping: **not established**.
- Dry run, imported records, rerun identity proof: **not performed**.
- Compliance query/report correspondence: **not verified against real S1**.
- Source access: `S1_DATABASE_URL` is not configured in this workspace.
  `SOURCE_CONFIG_DATABASE_URL` is for fund configuration, not an authorized
  substitute for the S1 source.
- The project confines production source inspection to its HIPAA boundary.
  Adding production credentials to this workspace is not the remedy.
- No UI or server behavior changed at this gate, so no built-in help change
  is appropriate yet. Historical-view help and authenticated help verification
  remain required alongside that implementation; local help must be preserved.

These are acceptance blockers, not passing or skipped migration checks.
