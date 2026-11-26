# Data Migration: Employer Wizards

## Status: importer built; real-source destination acceptance outstanding

The approved destination is **actual S2 wizard records**, not historical
placeholders. The CLI importer and read-only historical view are implemented.
Source code now establishes the type/status/period extraction rules below.
The historical Q16 source-link reconciliation resolved 4,163 candidates and
left 153 unresolved. The operator initially approved that inspected cohort as
allowed rejects, then on 2026-11-20 superseded the identity-scoped allowance
with reason-based allowances for `missing_upload_parent` and
`missing_employer_node`. Authorized destination rehearsal remains outstanding;
this is not a completed migration report.

### Approved implementation-first merge

The operator explicitly approved merging the implementation before completing
the protected-environment migration rehearsal. Implementation delivery and
data-migration acceptance are therefore separate: the code may be merged while
the real-source destination checks below remain unverified. This approval
does not waive source/data safeguards, approve the extra malformed-type record,
or establish successful historical imports. The reason-based reject policy is
recorded below.
Follow-on acceptance must cover both database reconciliation and authenticated
historical/native wizard, compliance, and help behavior.

The supplied daily report contained neither a `sirius_feed` staging entry nor
an `employer-wizards` fleet entry; the operator's S2 count confirmed zero staged
feed rows. Inspection of its supplied build commit also found both changes
absent. That run is not an importer rehearsal. A migration image must include
the merged implementation before a meaningful importer rehearsal can occur.

### Representation contract

- Preserve the real supported S2 upload type, employer, reporting year/month,
  source chronology, and evidence-backed status.
- Retain original source identity and original type/status values for traceability.
- Historical file bytes are held in the S1 archive bucket and deliberately not imported into S2. Do not create attachments,
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

### Second operator pass: Q9–Q11

- Every candidate `complete` node has an object at `$.wizard` (2,563 main
  and 1,437 correction). This proves payload presence, not successful processing.
- Main drafts: 16 have the wizard object and 12 have no JSON field.
  Correction drafts: 162 have the wizard object and 126 have no JSON field.
- Q10 finds 2,580 occurrences of the main root and 1,599 correction roots,
  versus Q9's 2,579 and 1,599 payload-bearing nodes of the matching source
  types. Root/type agreement must be checked explicitly; do not discard
  or adopt the one-record difference by assumption.
- Q11 returned exactly 300 groups, ending alphabetically before either
  hours root. It is **truncated**, not evidence of absent hours fields.
- Use
  [`s1-employer-wizard-hours-structure.sql`](../../scripts/oneoffs/s1-employer-wizard-hours-structure.sql)
  for Q12–Q14. This scopes discovery to the two candidate roots without an
  output cap, checks root/type correspondence, lists immediate keys and
  selected control-container child keys, and counts positive integer
  `process_ts` evidence without returning payload values. No success
  meaning is assigned to that timestamp.
- The operator's first targeted run encountered MariaDB's “Illegal mix of
  collations for operation 'UNION'”. The targeted pack now explicitly
  normalizes every text projection on both union arms to `utf8mb4_bin`.
  Run `ROLLBACK` on the failed connection before rerunning the corrected
  pack. The operator subsequently returned Q12–Q14 successfully.

### Targeted operator pass: Q12–Q14

- Q12 resolves the one-root discrepancy: one node typed `complete` carries
  a main-hours root. It must remain an explicit anomalous-type case, not
  be silently converted based on its payload. The 12 main and 126 correction
  missing-root nodes correspond to the previously counted missing JSON.
- Q14 finds **no** root-level `process_ts` in any of the 4,316 correctly
  typed candidates. Absence at this path neither proves failure nor authorizes
  a different status. The earlier timestamp hint came from unrelated feed types.
- Q13 returned 1,799 groups. Both hours roots store `steps` objects plus
  mappings and uploaded-row-related objects; no immediate period key was found.
  Main root occurrences: 2,580; correction: 1,599. These are root occurrences,
  not a clean type-filtered attempt inventory.
- Fixed steps include `upload`, `map`, `verify`, `post`, `review`, and
  `statement`. Main roots also have a `process` object in only two cases.
  A step object existing is not evidence that the step completed.
- Most result groups were dynamically numbered worker/disability steps.
  Do not expand or export their contents. The next structure-only query,
  [`s1-employer-wizard-step-structure.sql`](../../scripts/oneoffs/s1-employer-wizard-step-structure.sql),
  inspects only fixed workflow steps, at most three object-key levels deep.
  It excludes arrays and named employee/result containers and returns no
  payload values. Source status semantics and reporting-month authority
  still require evidence before implementation.

The blanket `sirius_feed`/`feeds_*` DROP decision is **reopened for employer
upload history only**. It does not authorize importing unrelated feeds.

### Fixed-step operator pass: Q15

The operator returned 13 groups. Every inspected fixed-step object contains
only a Boolean `complete` key. Main-root `map`, `post`, `statement`,
`upload`, and `verify` flags occur on 2,580 roots; `review` occurs on 2,579;
`process` occurs on two. The six corresponding non-`process` flags each
occur on 1,599 correction roots. Q15 describes the **shape**, not whether
these flags are true or false.

No reporting-period field was found in the root or the inspected fixed-step
metadata. Employee/result containers were intentionally not expanded; this
does not establish absence of dates there. Do not substitute upload creation
month, filenames, period trackers, or migrated hours. In particular, the
investigation has not established that every correction upload concerns
exactly one reporting month.

Further structure-only SQL is insufficient to establish the workflow's
meaning. The next authority evidence should be the S1 implementations for
`sirius_smf_feed_ehrs` and `sirius_smf_feed_ehrs_correction`: how reporting
period/employer are chosen and saved, how `post` and `review` completion
relate to `field_sirius_feed_status`, and whether retries mutate one node
or create new nodes. Sanitized implementation code or an authorized
operator's explicit explanation backed by source inspection is required;
raw uploaded rows are not requested.

### Reviewed S1 implementation evidence

The operator supplied full SMF monthly subclass, feed definitions, correction
launcher, posting/review handlers, and shared wizard helper:

- The parent employer-upload record is a **`sirius_log` node**, category
  **`smf:ehrs`**, whose `field_sirius_log_handler` references the feed NID.
  `sirius_smf_feed_ehrs_get_eup` queries that relationship. This is **not**
  `sirius_employer_payperiod`. Its query takes the first matching row without
  ordering; the importer must instead count and reject ambiguous parents.
- `get_feed_node` reuses a main feed linked from that parent, creating one
  only when missing. It synchronizes the main feed's employer reference
  from the parent. `add_correction` launches another feed and links it to
  the same parent, but does not perform that employer-reference synchronization.
  Thus missing correction feed employer references are not by themselves
  proof of an unresolvable employer: the explicit parent relation must be checked.
- Both main and correction types use the same posting handler, taking year,
  month, and employer from that parent. A correction therefore uses one
  parent reporting period in this implementation; invoice display dates
  must not be substituted for it.
- The final posting batch operation requests `feed_status => complete`.
  The shared wizard helper marks the current `post` step complete, clears
  subsequent steps, and assigns the feed status. Hence `complete` does not
  require review, statement, or payment completion. Preserve that historical
  outcome without fabricating those completed steps or payment results.
- Row operations can return early for missing parent/period/employer while
  the final operation remains scheduled. Recorded `complete` is S1's
  recorded workflow outcome, **not independent proof every row succeeded**.
  Historical rendering must not claim verified processing totals.
- The parent class `Sirius_Employer_Monthly_Upload`, required from
  `sirius_employer.monthly_upload.inc`, was not included in the first source
  attachment. The subsequent base-class evidence below resolves its getters
  and upload-replacement behavior.

### Base-class and upload-replacement evidence

The additional source establishes the parent key as
`field_sirius_notes = employerNID/year/month`. The base class constructs that
key, reads year/month from its second/third slash-separated parts, and
resolves the employer through a `grievance_shop` handler on the same parent.
Its `eup` JSON mirrors those values but is not the getter's authority.
The parent key and explicit employer handler must agree; do not parse the
title or infer a period from created timestamps.

`feed_type_correction()` appends `_correction` to the main type. Main and
correction feeds thus represent the same monthly-hours family; both can
use S2 `bao_monthly_hours` with the original source type retained as evidence,
not an invented new plugin kind. Each feed NID remains a separate record;
ordinary newest-upload selection must remain unchanged.

Replacing an attachment invokes the same feed node's upload handler, creates
a `feed:prior` log referencing the old attachment, and changes the current
wizard data. This is not proof of an independently completed prior attempt.
Preserve the current feed identity/outcome; do not synthesize prior wizards,
files, steps, or processing results from those attachment logs. New
correction creation, in contrast, explicitly creates a new feed NID.

Recorded status mapping is `complete` → `completed` and `draft` → `draft`;
unknown values must be rejected. Preserve original values. The status
records S1's workflow outcome, not a claim of complete row-level success.

Next run
[`s1-employer-wizard-link-reconciliation.sql`](../../scripts/oneoffs/s1-employer-wizard-link-reconciliation.sql)
for Q16. It uses the actual parent/category/handler/key paths, rejects
ambiguous source relationships in its classification, compares feed-employer
references to parent authority, counts post/review flag evidence and
multiple attempts, and returns reporting-period aggregates plus up to five
feed NIDs per group. No raw notes, JSON, uploaded contents, or amounts leave
the source. This is source reconciliation, not a destination rehearsal.

### Earlier source-search results (superseded by full source review)

The supplied search transcript located calls to
`Sirius_Smf_Ehrs_Monthly::get_year`, `get_month`, and `get_employer` on a
separate `$eup_node`. The processing snippets refuse missing associations.
This points to a separate employer-upload record as the period authority;
the getter implementations and feed-to-upload lookup were still needed then.
It does not prove that this is the old auto-created period tracker.

The transcript locates `sirius_wizard_submit` in the hours `post.inc`, the
status setter in shared `sirius.wizard.inc`, and a feed-status copy in
`sirius_smf.ehrs_monthly.inc`. Search matches alone do not establish their
control flow or success semantics. The function extraction command selected
top-level functions beginning with `feed_ehrs`; it did not capture the
monthly class methods. Request the complete relevant source files rather
than another filtered search or raw database payload.

N3's observation that employer-period trackers are auto-created remains useful.
Its argument that migrated hours prove upload history is insufficient:
hours do not establish upload type, attempt, or status. Do not convert those
envelopes into completed wizards. The existing counted staging skip remains
unchanged until source evidence justifies a specific replacement.

## Actual source-link reconciliation: Q16

The operator's Q16 output has 141 groups and accounts for all **4,316**
correctly typed candidates: 2,591 main + 1,725 correction; 4,000 complete
and 316 draft.

| Classification | Feeds | Interpretation |
|---|---:|---|
| `SOURCE_LINKS_RESOLVED` | 4,163 | Unique parent/category/key and a unique matching live parent-employer handler |
| `MISSING_OR_AMBIGUOUS_LIVE_PARENT_EMPLOYER` | 139 | Parent exists, but no unique live employer resolved; the result does not distinguish missing from duplicate handlers |
| `NO_PARENT` | 14 | No matching `smf:ehrs` parent found |

Resolved-set findings:

- Main: **2,445**; corrections: **1,718**.
- Recorded complete: **3,866**; draft: **297**.
- **4,010** feed employer references match parent authority; **153** resolved
  feeds lack a feed employer reference. The explicit parent relationship
  proves those 153 employers/periods; this is not inference from hours.
  No resolved feed employer disagrees with its parent.
- **2,453** resolved feeds belong to employer/month groups with multiple
  attempts across main and correction types. This counts feeds, not distinct
  groups. Preserve their separate identities.
- Reporting periods range from **2019-01 through 2027-09**. These are
  source-declared periods, not proof of business correctness. Never replace
  them with creation month merely because they are historical or future.
- One resolved correction is recorded complete with Post=false. Preserve
  both pieces of evidence without manufacturing a successful Post result.
  Other resolved recorded-complete feeds have Post=true.
- All 4,177 candidates with a Boolean Review flag have Review=false; the
  remaining 139 lack a Boolean Review flag. Review completion must not be
  required or fabricated when mapping the source status.

The **153 unresolved** feeds comprise 134 recorded-complete and 19 draft
records. They do not yet have approved S2 employer/month associations.
Keep them as counted rejects pending explicit disposition; never synthesize
their relationships or silently treat them as accepted conversion results.
The operator's result retains bounded source-ID samples by classification.

### Unresolved relationships: investigation selected

On 2026-11-19, the operator chose to investigate the 153 unresolved source
relationships first, rather than proceed with an importer that excludes them.
After receiving Q17, the operator approved the inspected cohort as allowed
rejects; the later disposition below supersedes this initial investigation hold.

[`s1-employer-wizard-unresolved-links.sql`](../../scripts/oneoffs/s1-employer-wizard-unresolved-links.sql)
provides Q17, a read-only diagnostic for the same two structural cohorts.
It distinguishes absent employer nodes from duplicate/multiple live employer
handlers, compares the parsed numeric key with the explicit handler and feed
reference, and inspects incoming logs for missing owners, deleted handlers,
or handler-bundle discrepancies.

For uploads without a current parent, Q17 also counts retained revisions whose
feed handler and `smf:ehrs` category occur in the **same** revision. It does
not combine a historical handler with current notes, infer that an arbitrary
node revision proves employer type, or promote a prior-file log to an upload
parent. Any archived-parent hits require revision-consistent period/employer
inspection before a mapping can be approved.

Only source IDs, counts, parsed numeric reporting periods, and fixed diagnostic
labels are returned. There are no names, raw notes/JSON, file references,
employee rows, or amounts. The output has a 200-feed cap with an uncapped
window total and candidate census; cap-sized or changed results must be
reconciled, not interpreted as complete by assumption. Expected diagnostic
population at the Q16 snapshot is 153 of 4,316 candidates. This workspace
has not executed Q17 against S1.

### Operator-supplied Q17 findings

The supplied output contains **153 distinct feed IDs**, with every row reporting
4,316 current candidates and 153 diagnostic feeds. The 200-feed output cap
therefore did not truncate the supplied cohort.

**139 feeds: missing employer nodes, not competing employer links.**
These comprise 134 main feeds and five corrections, linked to 134 distinct
current parents. Every one has exactly one reporting key and exactly one
current handler pointing to that key's employer ID, but the target employer
node is absent. The query reports no retained `node_revision` rows for any
of these eight employer IDs:

| Missing source employer NID | Affected feeds |
|---|---:|
| 7603259 | 27 |
| 13226221 | 24 |
| 13227410 | 26 |
| 13247243 | 41 |
| 13247244 | 11 |
| 13253698 | 2 |
| 13254973 | 5 |
| 13255444 | 3 |
| **Total** | **139** |

All 136 populated feed-employer references agree with the parent key and
point to missing nodes; three corrections have no feed-employer reference.
All 139 have zero live employer handlers, rather than duplicate or multiple
live employer handlers. Their parsed source periods range from 2013-01 to
2025-11. This establishes consistent historical source IDs/periods, **not**
an existing S2 employer mapping or authority to recreate/reassign employers.
The evidence does not establish why the employer nodes are absent.

**14 feeds: no current upload parent.**
These comprise 12 main feeds and two corrections. Eight have a direct live
employer reference, two reference missing employer nodes, and four have no
feed-employer reference. None has a reporting key from an upload parent.
The output reports no alternative current `smf:ehrs` parent, deleted handler
to such a parent, or missing current handler owner. Eight have prior-file
logs, but those do not supply reporting-period or processing-status authority.
One other feed has a current log that was not classified as a prior-file
log; its category has not been inventoried. A direct employer reference
alone is insufficient to synthesize the missing period.

**Query provenance discrepancy: retained-revision columns are not accepted
as verified recovery evidence yet.**
The returned archive columns report one retained parent revision for each
of the 139 feeds that already have a current parent, with its parent ID
matching that current parent. The supplied Q17 SQL restricts the
`archived_links` CTE to `u.parent_count = 0`, so its intended execution should
produce no archive match for those 139 rows. The 14 no-parent feeds report
zero retained parents. Obtain the actual executed SQL or independently
recheck this portion before treating the archive search as a proven absence
of recoverable parents. Do not discard this discrepancy or assume a cause.

No source relationships have been repaired and no native S2 employer mappings
have been checked for these missing source IDs.

### Current reason-based disposition (2026-11-20)

The operator explicitly replaced the original identity-scoped policy with the
same reason-based `--allow-rejects` convention as the other loaders. Ad hoc
callers pass `--allow-rejects missing_upload_parent,missing_employer_node`;
both sync fleet profiles pass those same reasons. The allowance covers all
unmapped source records with either reason, including identities outside the
original 153. Without the argument those rejects still fail the normal gate.

Each rejection retains its original reason, source-ID sample, and count.
Source relationships are re-evaluated every run; resolved records are imported,
not permanently skipped. Already-mapped sources that lose their relationships
remain `mapped_source_unresolved`, and other rejects (including
`unsupported_source_type` for `complete`) remain blocking. The old
`approved_historical_upload` alias is no longer accepted. The JSON manifest
below is retained only as historical inspection evidence; nothing at runtime
imports it. No source repair, deployment, or migration execution is authorized
by this policy change. No user-facing screen/help behavior changed.

### Original approved disposition after Q17 (superseded)

The operator stated that these are probably stale old test files and explicitly
approved treating them as `allowed_rejects` in the migration script. “Test files”
is an operator hypothesis, not a verified source attribute. Further recovery
investigation is not a prerequisite for this approved cohort.

The original allowance was for the **153 inspected feed identities**, grouped by their
observed reason in [the approved cohort](employer-wizard-approved-rejects.json):
139 `missing_employer_node` and 14 `missing_upload_parent`. The manifest records
approval evidence originally consumed by the importer. The exact ID/reason pairs became
the standard `approved_historical_upload` reject class. This original
identity-scoped implementation is superseded by the reason-based policy above.

- Keep these records counted as rejected, not imported, completed, or absent.
- Match both source feed identity and the observed reason. Never authorize
  arbitrary new rejects just because they share the reason or count.
- Re-evaluate source relationships each run. A repaired record is no longer
  rejected solely because its ID appears in the approved cohort.
- Missing destination mappings, changed rejection reasons, unsupported status,
  or unrelated data failures are not covered by this approval.
- Retain aggregate totals and source-ID/reason evidence in migration reports.
  No S1 deletions, employer recreation, or source repair is authorized.
- The archive-query discrepancy above remains documented, but does not block
  this explicit disposition. It must not be presented as verified recovery.

At this source snapshot, expected accounting is 4,316 candidates =
4,163 source-resolved candidates + 153 approved rejects. Destination mapping
and verification can still expose additional blocking failures.

No destination records have been written. Target-side dry run, authorized
rehearsal, repeat-run proof, and authenticated compliance comparison remain
outstanding. The source census alone is not migration acceptance.

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

### Implemented fleet contract

- `sirius_feed` joins the stage bundle list; parent `sirius_log` and employer
  `grievance_shop` already belong to staging. The auto-created period tracker
  remains excluded.
- `s1-employer-wizards`, logic version 1, runs immediately after employers.
  Both supported source types retain distinct feed identities and map to
  `bao_monthly_hours`. Status is complete → completed or draft → draft.
- Migration SQL is owned by the S1 Oneoff module, with no HTTP execution
  route. The standard loader envelope and retained run reports use existing
  monitoring; no new execution button or plugin kind is introduced.
- Each source feed has deterministic target identity `s1-employer-upload-NID`
  plus an `s1_employer_wizard` crosswalk entry. A bounded transaction lock
  serializes that source identity. Parent, monthly association, crosswalk,
  and exact destination verification commit together. Conflicting native
  identities are refused, never adopted.
- Stored data contains only source reference/status/type/period/timestamps and
  the saved Post/Review Boolean evidence. No uploaded rows, paths, attachments,
  fabricated S2 step state, or processing results are copied.
- Full runs reconcile every target, including unchanged fingerprints and
  missing targets after a restore. Missing source rows are preserved and
  block verification. A changed type or newly unresolved mapped source blocks.
- The historical view has no runnable controls; dispatcher routes refuse all
  historical actions. Ordinary mutation/progress/deletion predicates refuse
  imported records, normal create/update paths refuse marker injection, and
  attachment creation/download paths refuse historical records.
- Missing-parent and missing-employer rejects remain counted under their
  original reasons; the original snapshot had 153. The separate malformed source type
  `complete` is not approved and fails explicitly if present. Thus the source
  report may contain one extra unsupported candidate beyond the 4,316 correctly
  typed Q16 candidates; do not mistake that for a duplicate attempt.
- See the runbook for bounded and full dry-run/rehearsal commands. A dry run
  writes no wizard, association, mapping, or run report.

Acceptance still requires a bounded dry run and authorized rehearsal against
real source evidence, followed by exact source/destination comparisons through
the compliance storage query and authenticated report. Cover available types/
statuses, month boundaries, multiple attempts, report links, and native/
migrated coexistence. Record before/after hours and financial totals and
repeat-run identity proof. No permanent conversion-test suite is requested.

### Protected-environment acceptance access check (2026-11-20, before policy revision)

**BLOCKED; not migration acceptance.** The available execution environment is
the development workspace, not the authorized in-boundary migration host.
Secret-existence checks found no `S1_DATABASE_URL` or AWS access-key/session
secrets. Neither the AWS CLI nor Session Manager plugin is installed, and no
local AWS config/credentials files were found. No protected-environment task
session or current task-definition/image-digest evidence was supplied.
These checks establish this workspace's access limits, not the remote
environment's configuration or availability. Do not bring production database
credentials or raw source records into this workspace to bypass the boundary.

Source-only inspection at workspace commit
`b1ab2a291f8b4a1e75aabf710cd8b13ae5adae61` confirmed `sirius_feed` in staging,
the version-1 employer-wizard loader immediately after employers, the
migration-owned reconciliation module, shared historical-upload representation,
and server refusal guards. At that time, both fleet profiles used the old
identity-scoped `approved_historical_upload` allowance; the manifest had 139
missing-employer identities plus 14 missing-parent identities (153 distinct
identities). That policy was later superseded as recorded above. Local source
inspection is **not** verification of the authorized migration image, a
successful dry run, or evidence about actual destination rows.

No migration command or database query was run during this access check.
The development database and fund-configuration connection were not substituted
for S1/S2. No deployment, schedule change, source repair, or conversion write
was attempted. No user-facing behavior changed; in-app help is unchanged.

To resume, an authorized operator must supply sanitized evidence from the
existing protected environment: the immutable task revision/image digest and
its source commit; verified staging and employer prerequisites; the bounded
and full dry-run envelopes; and a separately explicit rehearsal authorization
with the target and writer-pause/timezone prerequisites confirmed. The known
source type `complete` still needs identity-specific, evidence-backed disposition
before accepting a full run; it is not covered by the 153 approved rejects.
Q17's checked-in archive CTE still restricts matches to `parent_count = 0`;
the executed-query discrepancy remains unresolved without the actual executed
SQL or an independent in-boundary recheck.

Real S1/S2 aggregate and record correspondence, reporting-month boundary and
multiple-attempt comparisons, compliance storage-query results, before/after
hours and financial totals, and repeat-run identity/side-effect proof all remain
**not performed**, not passed or waived. No zero-delta claim can be made without
those measurements. The older daily report remains inadmissible as importer
evidence for the reasons above.

### Current reconciliation results and limits

- Current real-source comparisons: **not performed**.
- Real-source inventory/link reconciliation: Q1–Q17 supplied by the operator;
  all 4,316 candidates accounted for, 4,163 resolved and 153 unresolved.
  Q17 narrows 139 cases to eight absent employer nodes and 14 to missing
  upload parents; retained-revision query provenance needs confirmation.
- Source-code type/status/period rules: **established above**; live relationship
  reconciliation is recorded above; destination correspondence is not verified.
- Dry run, imported records, rerun identity proof: **not performed**.
- Compliance query/report correspondence: **not verified against real S1**.
- Source access: `S1_DATABASE_URL` is not configured in this workspace.
  `SOURCE_CONFIG_DATABASE_URL` is for fund configuration, not an authorized
  substitute for the S1 source.
- The project confines production source inspection to its HIPAA boundary.
  Adding production credentials to this workspace is not the remedy.
- Built-in wizard runner/launcher and migration-monitoring help now describe
  read-only history and unavailable files. Local help rows are untouched.
  Authenticated help listing/dialog verification remains outstanding.

These are acceptance blockers, not passing or skipped migration checks.

### Workspace verification of the implementation

- Application server/client typecheck passed.
- Architecture lint passed all 16 rules; no new core migration was introduced.
- One-time source resolver assertions covered complete with Post=false,
  missing-parent and missing-employer reasons, exact reject identity/reason
  membership, and placement immediately after the employer loader.
- The final application server/client typecheck and all 16 architecture lint
  rules passed. The existing fleet, version-contract, wizard attachment, and
  wizard recovery checks passed (56 checks across four selected files).
  The initial fleet failure
  exposed the source-inspection preflight's literal `LOGIC_VERSION` requirement;
  the loader was corrected to follow that contract and all 23 fleet checks passed.
- Built-in help registry lookup, HTML sanitization, intended wizard path, and
  near-miss paths passed. Local help rows were not modified.
- The final existing help suites reported 80 passing checks and one failure:
  the all-workflow browser-host inventory expects `/config/phone-numbers`
  for `system:contact-field-configuration`. That unrelated existing entry's
  path was not changed by this implementation. The broader suite is not a
  pass; distinguish this limitation from the importer-specific help checks.
- The application was restarted and its unauthenticated sign-in page rendered.
  The signed-in historical wizard, compliance report, and help dialog were
  **not** browser-verified.
- A bounded `--dry-run --limit 20` invocation was refused by the existing
  timezone gate before source scanning or any conversion writes: this workspace
  is unconfigured UTC, whereas the migration contract pins America/Los_Angeles.
  The pin was not overridden to force a pass. This is refusal evidence, not a
  successful dry run or source/destination comparison.
- `npx tsc -p tsconfig.scripts.json --noEmit` reports 12 existing
  `cronJobRuns` property errors in `scripts/oneoffs/smoke-s1-write-fence.ts`;
  no diagnostic names the new importer files. That gate is not a pass.
- `npx tsx scripts/check-migrations.ts --base=origin/main` fails on existing
  core migration versions 1107–1120 versus the base's maximum 1120.
  That stale upstream base is not the configured merge gate. The normal
  `bash scripts/dev/check-migrations-merge.sh` gate passed its deployment-branch
  comparisons. This task changes none of those migrations and does not
  renumber them.

No conversion writes, hours changes, financial writes, or source repairs were
performed in this workspace. Under the approved implementation-first merge,
protected-environment rehearsal and comparisons remain mandatory before
accepting the data migration, not a claimed result of implementation delivery.
