# S1 to S2 file migration: plan v2

2026-11-21 · Rebuilt 2026-11-21 after the original link was lost. Live doc: https://claude.ai/artifact/CGJvyadx3D8rP7nfN47owx

## Summary

This plan moves about 11,600 S1 file attachments into S2 and attaches each one to its worker, employer or payment. About 11,400 more files are archived in S3 and never shown in the app. About 440 in-scope files no longer exist on the S1 server; they are reported, not migrated.

It replaces the 2026-11-20 handoff. It keeps that design (an archive bucket kept out of `FILESYSTEMS`, a reconciling loader, `createWithFile` as the write path) and fixes what the code review found. The S2 code was checked against `samknelson/sirius` branch `bao-replit-main` at 552d7e5, and S1 against `samknelson/grievance`. The changes from the handoff are listed at the end.

The work has two parts with different owners:

- **Part A, operator (Mitchell):** AWS and S2 configuration. No code.
- **Part B, Replit:** a staging addition and a new loader, `scripts/s1-migration/load-files.ts`, which joins the daily fleet.

All eight decisions (D1 to D8) were made on 2026-11-21. This plan is final and ready for Replit to build Part B.

This plan supersedes T10 in `03-transformations.md`, and closes Q38 in `05-open-questions.md` and N22 in `06-strategy-revision.md`.

**Out of scope:** importing contract PDFs as S2 contracts (T23), importing employer upload history as S2 wizards, and any change to how S2 stores or serves files.

## Decisions needed

All decisions are made. The build spec below follows each ruling; the right-hand column names the section it shapes.

| # | Decision | Ruling | Status | Affects |
| --- | --- | --- | --- | --- |
| D1 | How to keep the S1 upload date. No S2 API can set `files.uploaded_at`: `insertFileSchema` strips it and `storage.files.update` excludes it. | The loader sets `uploaded_at` with one SQL `UPDATE` inside the same transaction as `createWithFile`. S2 storage code is not changed. | **Decided 2026-11-21** | B5 |
| D2 | How to label materials. All 6,482 materials have a JSON title. The only document type in use is "material", so the title is the only label to keep. | Attachment name = material title, falling back to `file_managed.filename`. Summary goes in `entity_files.data`. No document-type field. | **Decided 2026-11-21** | B5 |
| D3 | S1 file fields the handoff didn't cover. Counts show none holds an in-scope file: employer `field_sirius_attachments`, payperiod direct attachments and `grievance_log` attachments are all zero. `public://` holds 5 page and template images and 1 signature. | Ignore all of them. No new rows migrate. | **Decided 2026-11-21** | Scope |
| D4 | Election wizards with no worker handler. Today there are none: all 1,458 file-bearing wizards have a worker handler, and their JSON worker exists. | Keep the JSON `worker_nid` fallback as a guard (expected 0). | **Decided 2026-11-21** | B3 |
| D5 | Whether files on draft election wizards migrate. 25 draft wizard logs carry files; 10 are approved and 1,423 posted. | Migrate them, and record the wizard status in `data`. | **Decided 2026-11-21** | B3 |
| D6 | Who sees migrated files. The worker, employer and payment file areas are open to all staff. | All staff can see migrated files for now. Permissions will be tightened later, as separate work. Acceptance criterion 7 tests that non-staff users cannot. | **Decided 2026-11-21** | Acceptance |
| D7 | Worker logs outside material and election. 2,405 files in 11 categories, all staff contact types except `worker:member_status` (3 files) and `smf:notes` (2). | Replace the catch-all with an allow-list of these 11 categories (see Prod counts). A new category rejects as `category_unruled` until it is ruled on. | **Decided 2026-11-21** | B3, B8 |
| D8 | Uploader for files whose S1 user isn't mapped. | Use the sentinel string `system:s1-migration`, not a real user row. The column has no foreign key and the UI never shows it. | **Decided 2026-11-21** | B7 |

## Prod counts (2026-11-21)

These come from the read-only count pack ([s1-file-count-queries.sql](/mnt/project-files/file-migration/s1-file-count-queries.sql), Q1 to Q7) run against S1 prod. They are attachment rows; every row is a distinct file.

**Worker log categories under D7** (the proposed allow-list):

| Category | Main log types | Logs | Files |
| --- | --- | --- | --- |
| comment | private, public | 1,210 | 1,566 |
| call from member | enrollment, eligibility | 399 | 497 |
| office visit | mlk issues, public, delta appeal | 147 | 180 |
| call to member | enrollment followup | 71 | 89 |
| issue reported for member | mlk issues | 37 | 56 |
| letter | appeal denial | 4 | 6 |
| helpline call from member | mlk issues | 1 | 3 |
| worker:member_status | set | 3 | 3 |
| onsite visit | scheduled | 2 | 2 |
| smf:notes | raw | 2 | 2 |
| email from member | eligibility | 1 | 1 |
| **Total** | | **1,877** | **2,405** |

**Other findings**

- **Handlers.** 9,812 file-bearing logs have exactly one worker handler; 3,628 have none (the feed, payment, employer, payperiod and dispatch logs). No log has a contact handler or two worker handlers, and no handler points at a deleted node.
- **Unresolvable.** 3 material logs have only handlers of other bundles, so they reject as `owner_unresolved`. That is far below the handoff's estimate of 25.
- **Dispatch.** 1 file (a comment) sits on a dispatch-handled log. The plan now treats it as archive-only instead of a reject.
- **Merges.** S1 has recorded 18 worker merges, between 2025-09-03 and 2026-07-23, and every merge log's JSON carries the merged-away nid. The merge map in B3 is viable.
- **Missing bytes.** 382 log attachments point at `temporary://`, so they reject as `bytes_missing`. The rest of the roughly 440 come from private files missing on disk, which the dry run's `HeadObject` checks will count.
- **Feed count gap.** Q1 finds 4,876 private `sirius_feed` attachment rows plus 5 with no `file_managed` row. The handoff said 7,860 feed files. Feeds are archive-only, so the loader is unaffected, but the archive-size estimate should be rechecked against the A4 dry run.
- **Total in scope:** 11,614 candidates (6,477 material, 2,303 election, 2,405 other worker, 136 contracts, 203 employer attachments, 38 employer logs, 52 payment logs). About 11,170 should migrate after `bytes_missing`.

## Scope and rulings

Every S1 file field gets a disposition. File counts are from the S1 prod count pack run on 2026-11-21 (see Prod counts) and grow by roughly 35 in-scope files a day.

| S1 source | Files | Disposition | S2 destination | File type |
| --- | --- | --- | --- | --- |
| `sirius_log` category `material`, worker owner | 6,477 | Migrate | Worker | Member Document |
| `sirius_log` category `trust:election_wizard`, worker owner (1,458 wizards: 1,423 posted, 25 draft, 10 approved) | 2,303 | Migrate | Worker | Election Document |
| `sirius_log`, worker owner, category on the D7 allow-list | 2,405 | Migrate | Worker | Note Attachment |
| `grievance_shop.field_grievance_contract` | 136 | Migrate | Employer | Employer Contract |
| `grievance_shop.field_grievance_attachments` | 203 | Migrate | Employer | Employer Document |
| `sirius_log` with a `grievance_shop` owner (36 comment, 2 material) | 38 | Migrate | Employer | Employer Document |
| `sirius_log` with a `sirius_payment` owner | 52 | Migrate | Payment (`ledger_payment`) | Payment Document |
| `sirius_feed` attachments | 4,876 (+5 with no `file_managed` row) | Archive only | None | None |
| `sirius_log` category `feed:prior` | 3,489 | Archive only | None | None |
| `sirius_log` category `auditlog` | 57 | Archive only | None | None |
| `sirius_log` with a `sirius_payperiod` or `sirius_feed` owner | 12 | Archive only | None | None |
| `sirius_log` with a dispatch owner | 1 | Archive only | None | None |
| `sirius_log` material with only other-bundle handlers | 3 | Reject `owner_unresolved` | None | None |
| Any in-scope row whose bytes are not in the archive (382 are `temporary://`) | about 440 | Reject `bytes_missing` | None | None |
| `sirius_trust_worker_election` (3, `temporary://`), `sirius_letterhead` (1), worker headshots (2), user signatures (2) | 8 | Ignore | None | None |
| `field_grievance_images` on page and letter templates (`public://`) | 5 | Ignore | None | None |
| Employer `field_sirius_attachments`, payperiod and `grievance_log` attachments | 0 | None needed | None | None |
| Files with no node reference, `temporary://` exports, `s3://`, blank scheme | about 7,700 | Ignore | None | None |

Rulings carried over from the handoff:

- **Log attachments migrate whether or not the log became an S2 note.** Where a note exists, the attachment records a pointer to it.
- **Election uploads attach to the worker,** not the election. S2 has no election file area.
- **Contracts attach as files only.**
- **S1 wins on deletion.** If a file or its owning record is deleted in S1, the S2 attachment is removed. The archive copy is kept.
- **Nothing in the archive is ever deleted automatically.**
- **Archive-only means the loader ignores the file entirely.**

## Source facts (S1)

**Storage**

- Private files are in `/var/www/sirius.benefits11.org/sites/default/files/private`: 19,400 files, 15.4 GB, URI scheme `private://`. Log and material uploads are moved to `private://attach_<random>` with no extension. The original name exists only in `file_managed.filename`.
- `temporary://` is `/tmp`. 7,755 of 8,044 such rows have no file on disk.
- s3fs is installed but not enabled. One `s3://` row exists and is ignored. `s3fs_file` has about 1,030 cache rows; they are not used.
- `public://` is used by three image and audio fields only. Those files are not in the private directory.
- The server has 2 GB RAM and no swap, so anything run there must be low-concurrency.

**Field shapes as staged** (`lib/extract.ts`)

| Field | Cardinality | Staged shape in `fields` |
| --- | --- | --- |
| `field_sirius_attachments` | unlimited | Array of `{fid, display, description}` |
| `field_grievance_attachments` | unlimited | Array of `{fid, display, description}` |
| `field_grievance_contract` | 1 | **A single `{fid, display, description}` object, not an array.** An array appears only if S1 has stray extra deltas. |

`display` is 1 on every upload path and `description` is empty. Neither is migrated: the `display = 0` handling in old T10 is dropped.

**Linkage facts**

- A log's category is `field_sirius_category` and its owners are in `field_sirius_log_handler` (multi-value). Normalize the category the way `lib/log-notes.ts` does.
- In prod, every file-bearing log has at most one worker handler. A handler can also be a `sirius_contact` node that resolves to exactly one worker; `load-log-notes` accepts these.
- An election wizard is itself a `sirius_log` (category `trust:election_wizard`). Its files are mostly dependent documents: the wizard JSON maps each `fid` to a `relationship_nid`. A staff-launched wizard has the worker as handler and later gains the election as a second handler. A wizard launched by SSN starts with **no** handler; the worker is in `json.wizard.trust_election.policy.worker_nid`.
- A material's title is in `json.material.title` (and the node title). Its document-type term name is in `field_sirius_type`, and its summary in `field_sirius_summary`. Editing a material can swap its file for a new `fid`.
- **Worker merge** (`sirius_worker.merge.inc`) re-points `field_sirius_log_handler` with raw SQL, writes a log (category `sirius_worker`, type `merge`, handler = surviving worker, JSON = the merged-away worker node) and then deletes the merged-away worker. The re-pointed logs are not re-saved, so their `changed` timestamp does not move.
- `sirius_dispatch` nodes are not staged, so a dispatch handler cannot be looked up in `s1_staging.records`.
- 3,015 files are on both a `sirius_feed` and its `feed:prior` log. Both are archive-only.
- `grievance_shop` is the employer bundle.
- Uploader (`file_managed.uid`) on private files: 18,666 active users, 741 blocked, 14 deleted, and 418 system or anonymous.

**Known gaps**

- About 380 log attachments from 2025 and 2026 sit at `temporary://filefield_paths/...` and are gone. They are broken in S1 today.
- 56 private log attachments (mostly from 2019), 2 employer files and both worker headshots are missing from disk.
- 257 legacy feed files (7.9 GB) are missing from disk. They are archive-only.
- The bucket `sirius-smf-prod` denies access by policy and is not used.

## Target model (S2)

The S2 side was checked against the code. S2 prod is believed to have zero rows in `files`, `entity_files` and `options_file_type`; confirm this during A7.

**Write path**

- `storage.entityFiles.createWithFile(contextId, entityId, file: InsertFile, name, typeId?)` inserts the `files` row and the attachment in one `runInTransaction`. Bytes must be uploaded first. `runInTransaction` nests: an outer transaction owns the commit, which is what B5 relies on.
- `InsertFile` has no `uploadedAt` and no attachment `data`. Provenance goes in `files.metadata`. `data` and `uploaded_at` are set inside the same outer transaction (D1).
- `files.entity_type` is `entity-files:<contextId>` and `files.entity_id` is the owner's S2 id. The `file.read` policy defers entirely to the area's access callback for these files.
- The storage location comes from the `entity_files_config` variable (`file_system`, `directory`). It is resolved with `resolveUsableContextConfig(contextId)` and `expandDirectoryTemplate(directory, entityId)`. `:entity-id` is the only token.
- Model the upload on `uploadEntityAttachment` in `server/services/entity-files/upload.ts`, **not** on `wizards/attachments.ts`. That means an object key of `<directory>/<uuid>-<safeName>`, checking the provider-reported size, and deleting the object if the insert fails.
- `deleteWithFile` removes the attachment and `files` rows, then removes the bytes after commit. `transferFileOwnership` drops the attachment row; do not use it.

**Areas used**

| Context | Owner id | Gate | Access |
| --- | --- | --- | --- |
| `worker` | `workers.id` | none | All staff |
| `employer` | `employers.id` | none | All staff |
| `ledger_payment` | `ledger_payments.id` (= id_map `payment`) | `ledger` component | All staff |

A file type's "Applies To" is `options_file_type.data.contextIds`, for example `["worker"]`.

**Background jobs that touch these rows**

- **`entity_files_orphan_sweep`** (enabled by default, 03:50 daily) and the delete-after event handlers remove attachments, `files` rows and bytes when the owning record is deleted in S2. The loader must notice when this happens (B6).
- **`file-consistency-sweep`** (disabled by default) walks only filesystems in `FILESYSTEMS`. It marks rows `missing`, records objects that have no row as `pending_delete`, and deletes them only when `deleteOrphans` is on, after a grace period (default 7 days). The archive stays out of `FILESYSTEMS`, so this sweep never sees it.

**Constraints**

- `entity_files.file_id` is unique: one file, one owner.
- `fileSystemService.upload` and `download` handle each file as one in-memory buffer.
- Prod `FILESYSTEMS` defines one filesystem, `private`: an S3 bucket using static keys. The S3 provider cannot use the ECS task role.
- Scripts read `FILESYSTEMS` from the real environment. The web app also accepts database overrides, so the migration task must carry the same value the app actually uses (A6).
- Storage-operation logs include file names (`Attached file "<name>"`). The loader must call `throttleStorageOpLogs()` like every other long loader, which needs verified maintenance mode on the target.

## How it flows

1. **Nightly, on the sirius server:** cron syncs the private files directory to the archive bucket. It only adds files, never deletes.
2. **Daily, in the ECS migration task:** the stage step also refreshes `raw_file_managed`.
3. **Daily, last in the fleet:** `load-files.ts` builds the candidate set from staged data. It skips anything already mapped that is still intact, copies new files from the archive to S2 storage, attaches them, and sweeps attachments whose S1 source is gone.
4. **At cutover:** run the nightly sync once more by hand after S1 goes read-only, then run a full stage and the loader one last time.

## Part A: operator runbook

All steps are in AWS account 142403088251, region us-west-2. The step-by-step commands are in [part-a-runbook.md](/mnt/project-files/file-migration/part-a-runbook.md).

**Status 2026-11-21:** A1 to A4 are done and verified (A4 copied 19,551 objects, about 16 GB). A6 is done up to registering the new task revision, which waits for the loader release. A second A4 dry run printed 0. The A5 cron line is not installed yet (`crontab -l` shows nothing). A7 was already configured in S2 prod and stays as it is.

### A1. Create the archive bucket (CloudShell)

```bash
B=bao-s1-files-archive-142403088251; R=us-west-2
aws s3api create-bucket --bucket $B --region $R \
  --create-bucket-configuration LocationConstraint=$R
aws s3api put-public-access-block --bucket $B --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket $B --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket $B --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-lifecycle-configuration --bucket $B --lifecycle-configuration \
  '{"Rules":[{"ID":"to-glacier-ir","Status":"Enabled","Filter":{},"Transitions":[{"Days":90,"StorageClass":"GLACIER_IR"}]}]}'
aws s3api put-bucket-policy --bucket $B --policy '{"Version":"2012-10-17","Statement":[{"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::'$B'","arn:aws:s3:::'$B'/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}'
```

New compared with the handoff: the TLS-only bucket policy. Objects under 128 KB stay in Standard (S3's default for lifecycle transitions), which slightly changes the cost estimate.

### A2. Give the sirius server a write-only role (CloudShell)

Unchanged from the handoff. Create the role `sirius-s1-files-sync` with `s3:ListBucket` on the bucket and `s3:PutObject`/`s3:AbortMultipartUpload` on its objects. Wrap it in an instance profile and associate that with `i-06a492daa9230e127`. The role can add objects but cannot read or delete them.

### A3. Install the AWS CLI on sirius, without sudo (sirius shell)

Unchanged. Install to `~/aws-cli` with the binary in `~/bin`, and confirm `~/bin/aws sts get-caller-identity` shows the sync role.

### A4. First copy (sirius shell)

```bash
SRC=/var/www/sirius.benefits11.org/sites/default/files/private
DST=s3://bao-s1-files-archive-142403088251/private/
~/bin/aws configure set default.s3.max_concurrent_requests 2
~/bin/aws s3 sync "$SRC" "$DST" --dryrun | wc -l      # expect about 19,500
nohup ~/bin/aws s3 sync "$SRC" "$DST" --only-show-errors > ~/s1-files-sync.log 2>&1 &
```

**Done 2026-11-21:** 19,551 objects, about 16 GB. When it finishes, the log should be empty and the object count should match the dry run. Permission errors mean the login user cannot read files owned by the web server; fix those before scheduling. The sync never passes `--delete`.

**Key convention the loader depends on:** S1 URI `private://<path>` is stored at key `private/<path>`.

### A5. Schedule the nightly copy (sirius shell)

```bash
0 23 * * * flock -n /tmp/s1-files-sync.lock $HOME/bin/aws s3 sync /var/www/sirius.benefits11.org/sites/default/files/private s3://bao-s1-files-archive-142403088251/private/ --only-show-errors >> $HOME/s1-files-sync.log 2>&1
```

The server clock is UTC. `sirius-s1-daily` starts at 00:01 UTC Monday to Friday, so the copy runs at 23:00 UTC. A nightly copy is incremental and takes minutes. An earlier version said 02:00 or 08:00; either leaves that day's uploads out of the next sync, where they would reject as `bytes_missing`. Check with `crontab -l`.

### A6. Migration task access and environment (CloudShell)

1. Find the migration task definition and its task role with `aws ecs describe-task-definition`, as in the handoff.
2. Attach the read-only policy `read-s1-archive` to the task role: `s3:ListBucket` on the bucket, and `s3:GetObject` on `private/*`. `HeadObject` uses `GetObject`, and `ListBucket` makes a missing object return 404 rather than 403.
3. **Compare `FILESYSTEMS` with the web app.** The migration task's value must be byte-identical to the one the web app actually runs with, including the bucket, region and any `prefix`. Check both the app's task definition and its Environment Variables page, because the app also accepts database overrides that scripts never read. A different prefix means the loader writes to keys the app never reads.
4. Confirm the task has both secrets that `FILESYSTEMS` references (expected to be `PRIVATE_S3_ACCESS_KEY_ID` and `PRIVATE_S3_SECRET_ACCESS_KEY`).
5. Add `S1_FILES_ARCHIVE_BUCKET=bao-s1-files-archive-142403088251` to the task environment.

**Resolved 2026-11-21.** The web app (`fc-web-server`) has no database overrides. It keeps `FILESYSTEMS`, `PRIVATE_S3_ACCESS_KEY_ID` and `PRIVATE_S3_SECRET_ACCESS_KEY` as plain environment variables on its task definition. `FILESYSTEMS` points at bucket `fc-web-server-4bcead-s7vk0xww` in us-west-2, with no prefix, and holds key names only. Done so far:

- The two keys were copied, without being printed, into a new Secrets Manager secret, `sirius-migration/private-s3`. The migration execution role can read it through the inline policy `read-sirius-migration-private-s3`.
- `read-s1-archive` is on `sirius-migration-task`. All four role policies and the bucket policy were checked, and bucket versioning is on.
- The new migration task definition is prepared in CloudShell as `mig-files.json`. It adds `FILESYSTEMS` (copied as is) and `S1_FILES_ARCHIVE_BUCKET` as environment, and the two keys as secrets from `sirius-migration/private-s3`.
- **Not done until the loader release:** registering that revision with the release image digest, a manual proof run, and repointing `sirius-s1-daily`, which is pinned to `sirius-migration:47` today. These are runbook step C6.

If fc rotates its S3 keys, refresh the secret (runbook C4). Separately, fc's keys sit in plain text on every web app revision, which is worth raising with whoever owns fc.

### A7. Configure S2 (S2 prod)

**Status 2026-11-21: already configured, keep as is.** S2 prod already has an `entity_files_config` with its own directory paths. Do not change it. The loader reads each area's `file_system` and `directory` through `resolveUsableContextConfig` and builds keys with `expandDirectoryTemplate`, so any directory template works. What must hold: `worker`, `employer` and `ledger_payment` are present and name a filesystem in the migration task's `FILESYSTEMS` (today only `private`). The loader checks this at startup. The JSON below is the original proposal, for reference only.

1. Under Config → Entity Files, set:

```json
{
  "worker":         { "file_system": "private", "directory": "workers/:entity-id" },
  "employer":       { "file_system": "private", "directory": "employers/:entity-id" },
  "ledger_payment": { "file_system": "private", "directory": "payments/:entity-id" }
}
```

   Keep any value already present. Leave `allowed` unset.

2. Confirm the `ledger` component is enabled. Payment files are unreadable while it is off.
3. Confirm `files`, `entity_files` and `options_file_type` are empty, or record what is there.

## Part B: build spec for Replit

Build one staging addition and one loader, `scripts/s1-migration/load-files.ts`. Use the house loader structure: reconciling sync through `lib/sync.ts`, a fail-loud reject gate, a verify pass, a deletion sweep and aggregates-only output. Confirm every S2 signature named here in the code before use, and run `npx tsc -p tsconfig.scripts.json --noEmit` before first execution.

### B1. Script bootstrap

A script does not get the app's boot sequence, so `load-files.ts` must do these itself before any write:

- Call `registerEntityFileContexts()` (`server/modules/entity-files-contexts.ts`) so `worker`, `employer` and `ledger_payment` exist in the registry.
- Let the filesystem registry load `FILESYSTEMS` from the environment, then check that `private` (or whatever the three areas name) is configured.
- Call `throttleStorageOpLogs()` and run writes under `withNotificationsSuppressed`, plus `withChargePluginsSuppressed` in `--migration-mode`, as `load-log-notes.ts` does.
- Call `ensureStagingSchema()` and `ensureIdMap()`.

**Environment source (updated 2026-11-21).** The web app has no database overrides, so the loader reads `FILESYSTEMS` and the S3 keys from its own task environment (A6) and does **not** call `initEnvOverrides()`. The bootstrap fails loudly before any write if `private` is not configured.

### B2. Stage `file_managed`

- Add the table `s1_staging.raw_file_managed`: `fid` (bigint primary key), `uid`, `filename`, `uri`, `filemime`, `filesize`, `status`, `timestamp`, `content_hash`, `extracted_at`. Follow the `raw_users` pattern in `lib/staging.ts`.
- Extract every row (about 28,000), upsert by `fid`, delete stale rows by watermark, and report counts the way `stageRawUserTables` does.
- Wire it into `stage.ts` so it refreshes on every daily run, honoring `--raw-only` and `--skip-raw`.
- `file_usage` is not staged. The `fid` values come from staged node fields (see the Field shapes table). Handle the single-object shape of `field_grievance_contract`.

### B3. Build the candidate set

One candidate is one (`fid`, owner) pair, derived fresh on each run.

**From `grievance_shop`:** each `fid` in `field_grievance_contract` is an Employer Contract. Each `fid` in `field_grievance_attachments` is an Employer Document. Employer `field_sirius_attachments` holds no files and is ignored (D3). The owner is the employer mapped from the node's own nid through id_map `employer`.

**From `sirius_log`:** take only rows where `fields ? 'field_sirius_attachments'`, adding a partial index if the filter is slow. Normalize the category as `lib/log-notes.ts` does.

**Merge map.** Before resolving handlers, build `mergedFrom → survivor` from staged `sirius_log` rows with category `sirius_worker` and type `merge`. The merged-away nid is in the log's JSON and the survivor is its handler. Follow chains to the final survivor. Replace every handler nid found in this map before resolving. This is what catches S1 merges that daily staging misses.

**Handler resolution.** For each handler nid, in order:

1. Staged `sirius_worker`, or a `sirius_contact` that resolves to exactly one worker: resolve **exactly as `resolveHandlers` in `load-log-notes.ts` does** (id_map `worker`, else id_map `contact` and then the worker with that `contact_id`). If a contact resolves to more than one worker, the result is `worker_ambiguous`.
2. Staged `sirius_payment` → id_map `payment`. Before writing, confirm the S2 id with the `ledger_payment` context's `entityExists`.
3. Staged `grievance_shop` → id_map `employer`.
4. Staged `sirius_payperiod` or `sirius_feed` → archive-only.
5. Not in `s1_staging.records` at all → `handler_unstaged`. This is the dispatch case; it counts as archive-only when the category is `auditlog`, and in every other case too (1 file in prod today).

**Rules.** Apply in order and stop at the first match:

| # | Condition | Result |
| --- | --- | --- |
| 1 | Category is `feed:prior` or `auditlog` | Skip, count `archive_only` |
| 2 | A handler resolves to a worker, category `material` | Worker, Member Document |
| 3 | A handler resolves to a worker, category starts with `trust:election_wizard` | Worker, Election Document |
| 4 | Category starts with `trust:election_wizard`, no worker handler, JSON `worker_nid` resolves (D4 guard, 0 today) | Worker, Election Document |
| 5 | A handler resolves to a worker, category on the D7 allow-list | Worker, Note Attachment |
| 6 | A handler resolves to a worker, any other category | Reject `category_unruled` |
| 7 | A handler is a `sirius_payment` | Payment, Payment Document |
| 8 | A handler is a `grievance_shop` | Employer, Employer Document |
| 9 | A handler is a payperiod or feed, or the only handlers are unstaged (dispatch) | Skip, count `archive_only` |
| 10 | No handler, or only handlers of other bundles | Reject `owner_unresolved` |

The D7 allow-list, matched after normalization: `comment`, `call from member`, `office visit`, `call to member`, `issue reported for member`, `letter`, `helpline call from member`, `worker:member_status`, `onsite visit`, `smf:notes`, `email from member`. Keep it as one constant in the loader, so adding a category is a one-line, reviewed change that bumps the logic version.

If the same `fid` appears on two in-scope owners, the lowest source nid wins and the others reject as `duplicate_fid`.

For election files, also capture `relationship_nid` (from the wizard JSON's `fid` map) and the wizard status (`field_sirius_type`, for example `draft`). For materials, capture the title, document-type name and summary (D2).

### B4. Read bytes from the archive

- Read the archive directly with the AWS SDK and the default credential chain (the ECS task role). The archive is not a `FILESYSTEMS` entry and must never become one.
- Register two environment variables in the env registry, as `lib/script-env.ts` does: `S1_FILES_ARCHIVE_BUCKET` (required) and `S1_FILES_ARCHIVE_PREFIX` (default `private/`).
- The key is the prefix plus the URI with `private://` removed. Any other scheme rejects as `bytes_missing`.
- Call `HeadObject` first. A 404 rejects as `bytes_missing`. Over `--max-bytes` (default 104,857,600) rejects as `too_large`. If the size differs from `file_managed.filesize`, use the object's size and record a `size_differs` finding.
- **Same-day uploads:** a file uploaded after the 23:00 copy is not in the archive yet. When `HeadObject` returns 404 and `file_managed.timestamp` is under 48 hours old, count it as `bytes_pending`, skip it without a reject, and retry it on the next run. After 48 hours it becomes `bytes_missing`.
- Put the reader behind a small interface (`head(key)`, `get(key)`) with an S3 implementation and a local-directory implementation, so dev and tests run without AWS.

### B5. Write to S2

At startup, resolve all three areas with `resolveUsableContextConfig` and exit before any write if one is unusable. Ensure the six file types (B7) as well.

For each new candidate:

1. **Provenance check.** Look for an existing attachment in the target context whose `files.metadata->'s1'->>'fid'` equals this `fid`. If one exists, record the mapping and treat the candidate as an update, not a create. This repairs a crash between create and mapping.
2. **Upload.** Key = `expandDirectoryTemplate(directory, ownerS2Id)` + `/` + a random UUID + `-` + safe name, using the safe-name rule in `upload.ts`. Call `fileSystemService.upload` and check that the returned size equals the buffer length.
3. **One transaction** (`runInTransaction`), containing:
   - `storage.entityFiles.createWithFile(context, ownerS2Id, file, name, typeId)` with `fileName` = `file_managed.filename`, `name` per D2 (truncated to 255), `mimeType` = `filemime` lowercased, `size` = the uploaded size, `uploadedBy` per D8, `entityType` = `entity-files:<context>`, `entityId` = the owner, `fileSystemId` from the area config, and `metadata` = `{ s1: { fid, uri, uid, sourceNid, sourceBundle, sourceField, category, type } }`.
   - `UPDATE files SET uploaded_at = <file_managed.timestamp> WHERE id = <new id>` (D1). Convert from unix seconds following `lib/timezone-contract.ts`, because the column is `timestamp` without a time zone.
   - `storage.entityFiles.update(...)` to set `data` = `{ s1Fid, s1SourceNid, s1NoteId, s1MaterialType?, s1MaterialSummary?, s1RelationshipNid?, s1WizardStatus? }`. `s1NoteId` comes from id_map `s1_log_note` for the source log, or null.
4. If the transaction fails, delete the uploaded object immediately, as `upload.ts` does, and reject as `create_failed`.
5. Record the mapping: id_map entity `file`, `s1_id` = `fid`, `s2_id` = `files.id`, loader `s1-files`.

### B6. Sync behavior

- **Fingerprint:** a hash of the staged `raw_file_managed.content_hash`, context, owner S2 id, type key, source nid, `s1NoteId`, and the D2 and election fields.
- **Fast path, with an integrity check.** Skip a candidate only if it is mapped, its fingerprint is unchanged, **and** its `files` row and attachment still exist. Check that with one database anti-join per run, with no S3 call. A mapping whose rows are gone (removed by the orphan sweep, or deleted by staff) is dropped and the candidate is treated as new.
- **Bytes are copied once per `fid`.** A rerun never re-copies a mapped, intact file.
- **Type, name, note pointer or data changed:** `storage.entityFiles.update` only.
- **Owner or context changed** (log re-pointed, or a worker merged via the merge map): `deleteWithFile`, then recreate under the new owner. Treat a `deleteWithFile` that returns undefined (already gone) as success.
- **Deletion sweep:** a mapped `fid` that is no longer in the candidate set is removed with `deleteWithFile` and its mapping dropped. If the sweep would remove more than 50 attachments in one run, block it as a finding unless explicitly allowed.
- **Run order:** add the loader as the last `FLEET` entry in `sync-config.ts`, with `--migration-mode` in `extraArgs`. Add it to the run-history dashboard.
- **Throughput:** sequential, or at most four files at a time. First run is about 11,600 files (6 to 7 GB); a daily run is about 35 new files.

### B7. File types and uploader

Ensure these idempotently, keyed by `sirius_id`. Follow `ensureNoteOptions` in `load-log-notes.ts`: abort if a type with the same name exists without the S1 id, and abort in a dry run if a type is missing.

| Name | `sirius_id` | `data.contextIds` |
| --- | --- | --- |
| Member Document | `s1-file-member-document` | `["worker"]` |
| Election Document | `s1-file-election-document` | `["worker"]` |
| Note Attachment | `s1-file-note-attachment` | `["worker"]` |
| Employer Contract | `s1-file-employer-contract` | `["employer"]` |
| Employer Document | `s1-file-employer-document` | `["employer"]` |
| Payment Document | `s1-file-payment-document` | `["ledger_payment"]` |

Uploader: map `file_managed.uid` through id_map `user`, ignoring stubs and mappings to missing users, as `loadCreatorContext` does. If unmapped, use `system:s1-migration` (D8). The original `uid` is always in `files.metadata`.

### B8. Rejects, findings and output

Every reject reason present in a run must be explicitly allowed with `--allow-rejects`, or the run exits 1 after the full report.

| Reason | Meaning | Expected in prod |
| --- | --- | --- |
| `bytes_missing` | No archive object, or the URI is not `private://` | About 440 (382 are `temporary://` log attachments) |
| `owner_unresolved` | No migratable owner | 3 |
| `bytes_pending` (not a reject) | Under 48 hours old and not yet in the archive (B4) | A few on most days |
| `category_unruled` | A worker log whose category is not on the D7 allow-list | 0 today |
| `worker_unmapped`, `worker_ambiguous`, `employer_unmapped`, `payment_unmapped` | The owner exists in S1 but has no single S2 mapping | Possibly |
| `file_row_missing` | `fid` on a node but not in `raw_file_managed` | No |
| `too_large` | Over `--max-bytes` | Unknown |
| `duplicate_fid` | The same file on two in-scope owners | No |
| `upload_failed`, `create_failed`, `update_failed`, `delete_failed` | Storage errors, reported as sanitized codes | No |

Findings: `size_differs`, `sweep_over_limit`, `mapping_repaired` (from the B5 provenance check), and `mapping_dangling` (from the B6 integrity check).

Output is aggregates, S1 `fid` and nid values, and opaque S2 ids only. It must include **counts by normalized category** for rule 5 (D7). Never print file names, URIs, material titles or descriptions. Save the `bytes_missing` list, by `fid` and source nid, as the source for the fund's missing-files list.

### B9. Verify pass

For every candidate processed and not rejected, check:

- the mapping exists;
- the `files` row is `live` with the expected `entity_type`, `entity_id`, size and `uploaded_at`;
- the attachment exists in the expected context with the expected type, name and `data.s1Fid`;
- `fileSystemService.stat` on the storage path returns the same size.

A failure blocks fingerprint advance, so the row retries on the next run.

### B10. Command line and docs

```bash
npx tsx scripts/s1-migration/load-files.ts [--dry-run] [--migration-mode]
    [--force-reconcile] [--allow-rejects r1,r2] [--allow-findings k1,k2]
    [--max-bytes N] [--limit N]
```

`--dry-run` builds candidates, resolves owners and runs the `HeadObject` checks. It writes nothing and reports counts by context, type, category and reject reason. `--limit` caps new files written, for the first rehearsal.

Docs to update:

- `RUNBOOK.md`: add a loader section.
- `03-transformations.md`: mark T10 superseded.
- `05-open-questions.md`: close Q38, noting the `s3fs_file` count against the single `s3://` row.
- `06-strategy-revision.md`: close N22 and replace the file-migration sentence above §4.17.
- `employer-wizard-history.md`: change "Historical file bytes are unavailable in S2" to say the bytes are held in the S1 archive bucket and deliberately not imported.
- `load-employers.ts`: update the two `SHOP_UNLOADED_FIELDS` comments.

## Acceptance criteria

The migrator is done when all of these hold on a rehearsal against real data:

1. A dry run reports candidate counts by context and type within 2% of the Scope table, adjusted for growth since 2026-11-20. The category breakdown for rule 5 has been ruled on (D7).
2. A full run exits 0 with only `bytes_missing` and `owner_unresolved` allowed, or with every other reason individually ruled on.
3. Migrated attachments plus rejected candidates equals total candidates.
4. An immediate second run writes nothing: zero creates, updates and deletes, and zero `GetObject` calls.
5. The verify pass reports zero failures.
6. Spot checks in the S2 UI pass for a worker with a Member Document, a worker with an Election Document, an employer with a contract and a payment with an attachment. Each file is listed with the expected name, **the original S1 upload date** and the correct type, and it downloads and opens.
7. A signed-in non-staff user, including the member, cannot download a migrated worker file. Staff can download it (D6).
8. Deleting a test attachment's source in a staging copy of S1 removes the S2 attachment on the next run, and the archive object remains.
9. Merging two test workers in a staging copy of S1 moves the merged-away worker's files to the survivor on the next daily run, without a full stage.
10. Killing the loader between create and mapping, then rerunning, leaves exactly one attachment and records `mapping_repaired`.
11. Deleting a migrated attachment in S2 and rerunning recreates it and records `mapping_dangling`.
12. A daily run with about 35 new files adds under five minutes to the fleet.
13. No file name, URI, material title or member identifier appears in loader output, saved run reports, `winston_logs` or task logs.
14. No archive-only file has a `files` row.

## Open items

| # | Item | Owner | Blocks |
| --- | --- | --- | --- |
| 1 | ~~Run the S1 count pack.~~ Done 2026-11-21; results are in Prod counts. | Mitchell | Done |
| 2 | Rule on D1 to D8: all decided 2026-11-21. | Mitchell | Done |
| 3 | Finish Part A: install the A5 cron line, and run C6 at the loader release. A1 to A4, A6 up to C5, and A7 (existing config) are done. | Mitchell | Rehearsal |
| 4 | ~~Confirm the migration task's `FILESYSTEMS` matches the web app's.~~ Done 2026-11-21: copied as is from the web app's task definition. | Mitchell | Done |
| 5 | Fund confirmation for D6: not needed. All staff for now, tightened later. | Mitchell | Done |
| 6 | Tell Sam that worker merges are invisible to daily staging (18 merges since 2025-09). `load-log-notes` and other handler-based loaders are probably affected too. | Mitchell | Nothing for this loader |
| 7 | Recheck the feed archive estimate: 4,876 feed attachment rows against the handoff's 7,860. Compare with the A4 dry-run count. | Mitchell | Nothing for this loader |
| 8 | Retention ruling for the archive. Proposed: never delete automatically. ERISA §107 sets a six-year floor and §209 sets no end date for records that determine benefits. Counsel should confirm, including any California rule. | Fund and counsel | Any future deletion |
| 9 | Missing-files list for the fund, from the first rehearsal's `bytes_missing` list. | Mitchell | Nothing |
| 10 | Server access logging for the archive bucket, which needs a separate log bucket. | Mitchell | Nothing |
| 11 | The `sirius-smf-prod` bucket denies access. Only worth pursuing if the fund wants the missing 2022 to 2025 feed files. | Mitchell | Nothing |

**Closed since the handoff:** the consistency-sweep question (it deletes only when `deleteOrphans` is on, after a grace period, and only on `FILESYSTEMS` entries) and the activity-log question (loaders already suppress storage-operation logs by default).

## Changes from the 2026-11-20 handoff

- **Upload date:** set by SQL inside the create transaction, because `InsertFile` cannot carry it (D1).
- **Worker merges:** detected through a merge map built from S1 merge logs, because daily staging misses them.
- **Crash safety:** a provenance check before create, all row writes in one transaction, and immediate object cleanup on failure.
- **Dangling mappings:** the fast path checks that rows still exist, so files removed by the S2 orphan sweep come back.
- **Model file:** `services/entity-files/upload.ts`, not `wizards/attachments.ts`.
- **Bootstrap:** the script registers file contexts and suppresses storage logs itself.
- **Handler resolution:** copies `load-log-notes` (contact fallback, ambiguity reject). The incorrect shell-worker reference is removed.
- **Dispatch:** an unstaged handler is now its own reason instead of falling into `owner_unresolved`.
- **Field shape:** `field_grievance_contract` is a single object.
- **Scope:** rows added for every S1 file field, with prod counts; nothing new migrates, and employer `field_sirius_attachments` holds no files (D3).
- **Election wizards:** SSN-launched fallback, drafts, and dependent links recorded (D4, D5).
- **Materials:** title, document type and summary kept (D2).
- **Uploader:** sentinel string instead of a system user (D8).
- **Access:** criterion 7 reworded, because all three areas are open to all staff (D6).
- **Acceptance:** criteria added for merges, crash recovery and dangling mappings.
- **Part A:** TLS-only bucket policy, the `FILESYSTEMS` parity check, the `ledger` component check, and N22 closed.
- **Same-day uploads:** `bytes_pending` instead of a reject for files under 48 hours old (B4), with the nightly copy moved to 23:00 UTC (A5).
