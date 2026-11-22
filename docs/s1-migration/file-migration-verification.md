# File migration verification

## Production files reject allowance — 2026-11-22

The production files profile allows exactly `bytes_missing`, `owner_unresolved`
and `file_row_missing`. The first two follow plan v2 acceptance criterion 2;
the operator ruled the two production `file_row_missing` rejects acceptable
on 2026-11-22 because their referenced fids no longer exist in S1 `file_managed`.
The dev profile remains unchanged. `category_unruled`, `extension_disallowed`,
`owner_missing`, `source_json_invalid` and `merge_unresolved` still fail the
loader and fleet gates.

## Lock-connection recovery verification — 2026-11-22

- Scripts type check passed; file and fleet-gate tests passed (15 tests).
- Isolated `rehearse-files.mjs` passed all 27 loader runs.
- A real loader dry run paused for 901 seconds with PostgreSQL
  `idle_session_timeout = '2min'` on its pool sessions. The advisory lock
  remained held and the loader completed successfully using 60-second heartbeats.
- A mapping trigger terminated the lock backend and its own active backend
  after the attachment transaction committed. The loader exited nonzero with
  `s1-files failed: database_connection_lost`, no driver stack/error details
  (the existing informational logging-suppression notice remains).
- Immediate rerun emitted `mapping_repaired` for the interrupted create and
  retained exactly one attachment. Existing rollback/byte-compensation checks
  also passed.
- Source-only delivery to `bao-replit-main`; no image build/publication,
  ECS definition, schedule, or production database changes.

## Local evidence

Verified on 2026-11-21 without contacting a production database, archive,
application, task, or scheduler. The unrelated mockup artifact was not changed.

- `npx tsc -p tsconfig.scripts.json --noEmit` passed before the first loader
  execution and after the final runtime changes.
- `npx vitest run tests/s1-migration/files.test.ts tests/s1-migration/fleet-gate.test.ts`:
  15 passing tests, including production allowance gates and isolated malformed
  source/merge handling.
- `node scripts/s1-migration/dev/rehearse-files.mjs`: 25 passing loader runs,
  plus conflicting/incompatible-type startup refusals in both modes and
  unverified-inventory refusal.
- The rehearsal starts a separate local PostgreSQL cluster with two disposable
  databases, asserts their identities, and gives child commands a clean
  environment. Archive and destination bytes are separate local directories.
  The source SQL adapter translates MySQL placeholders for PostgreSQL; it is
  not proof of MariaDB transport behavior.
- Raw extraction interruption preserves the previous inventory. A first-attempt
  change followed by stable reads publishes on attempt two. Three changing
  attempts preserve both the inventory and its evidence row. The actual stage
  CLI, executed with an isolated source adapter, exits zero and reports
  `skipped_changing`; other raw-table reports pass. The subsequent files loader
  exits nonzero with `file_inventory_unverified` and changes no tracked rows.
  A complete refresh removes stale rows and restores count/admission evidence.
- All six types, scalar contracts, draft election JSON fallback and dependent
  links, direct/contact worker resolution and ambiguity, employer/payment
  rejection, normalized D7 totals and unknown-category rejection were exercised.
- Real attachment storage preserves original names, MIME types, provenance and
  upload instants. The real file HTTP handlers return synthetic bytes to staff,
  and deny a non-staff uploader with 403. No existing/live application server or
  authenticated browser session was used.
- Reruns create/update/delete nothing and perform zero archive GETs.
  A staged size mismatch emits exactly one first-run `size_differs`; the
  immediate rerun has zero findings, writes and archive GETs.
  Material metadata edits use zero archive GETs. Fresh merge logs move files
  without editing or restaging their attachment-bearing logs.
- Verification failure remains retryable; provenance adoption repairs a
  create/mapping interruption; missing target rows are recreated; transactional
  attachment failure rolls back rows and removes the uploaded object.
- Missing, recent pending, oversized and non-regular/inaccessible archive
  entries remain distinct. Limits apply to new writes without losing the
  remaining candidates. A 51-file sweep deletes nothing until explicitly
  allowed. Archive bytes survive destination deletion.
- Dry-run snapshots of files, attachments, mappings, types, variables,
  metadata, logs and run history remain identical.
  This includes a first-ever run with no types: it reports
  `fileTypesToCreate: 6`, performs six HEAD checks and creates no objects.
- Malformed material/election JSON, malformed merge logs with known/unknown
  from-nids, conflicting edges, cycles and upstream merge dependencies are
  isolated. A single missing-owner preflight is simulated at the context API;
  all remaining storage is real. Two healthy candidates still load while the
  run reports two `source_json_invalid`, four `merge_unresolved`, one
  `owner_missing`, and a count-only malformed-log finding. The run exits one;
  an explicitly allowed isolated rerun exits zero without archive GETs.
- Synthetic canaries were absent from loader console output, result envelopes
  and storage logs, including forced database failures.

Rehearsal artifacts are deliberately ignored under `generated-artifacts/`.
The latest successful run at implementation time is
`generated-artifacts/s1-files-1795361406415/evidence.json`.
Rerunning the documented command creates a new isolated evidence directory.

## Implementation notes

The existing run-history view enumerates `s1_staging.runs` dynamically; it has
no fixed loader catalog to extend. The new loader records its standard
`s1-files` envelope there and is last in the existing fleet.

Existing attachment help remains applicable: there are no new application
actions or permission rules. Operational instructions belong in the migration
runbook, not general user help. No signed-in browser UI verification is claimed.

The pre-existing write-fence smoke script named the retired `cronJobRuns`
storage member. Its references were updated to the current `jobRuns` member
to satisfy the required scripts compilation gate; scheduler behavior was not
changed.

Historical timestamp SQL uses the UTC-naive representation consumed by the
current Drizzle Date codec. Both database storage and the actual file API
response were checked against the source epoch; simply using the session's
Los Angeles wall clock would shift the instant exposed by the API.

## Release and remaining acceptance

The daily-loader fixes above change no Part A configuration, ECS definitions,
schedules or production data. Delivery is source-only to `bao-replit-main`;
the operator must build the image from the reported commit. No image was built
or published for these fixes. The earlier implementation's image notes below
are historical evidence, not a release of this patch.

The dedicated `migration` image was built locally from the implementation,
without inheriting the full web development-dependency stage. Network-disabled
runtime checks prove that the TypeScript runner, AWS S3 SDK, archive reader and
candidate module are packaged.

**Registry publication blocker:** no authorized registry publishing path is
configured for this workspace. A local image build is not a registry release.
No immutable `repository@sha256:...` registry manifest digest is available, and
neither a Git revision nor a local image ID is offered as a substitute.
No ECS definition or schedule was changed.

Operator-owned real-data acceptance remains outstanding: count tolerance against
the final plan, live archive completeness, missing-file review, throughput on
the real daily population, and UI spot checks of representative records.
Those require a separately authorized operator rehearsal; synthetic evidence
does not establish them. Part A is left unchanged.
