# Production financial-link repair: operator evidence

## Status and approved scope

Operator execution is through AWS CloudShell/ECS inside the HIPAA boundary.
No remote command is executed by the assistant.

On 2026-10-15 the operator explicitly approved changing acceptance from a
historical common-source/checkpoint comparison to the data currently staged
in production S2. This does not establish historical AR exact-set extraction
equality. That proof remains unverified, not silently replaced with counts.

The approved sequence starts with read-only inventory. Applying changes still
requires separate operator approval of its exact evidence hash. All identity,
ownership, transactional preservation and post-repair verification safeguards
remain required. No restaging, source mutation, sync, deployment, schedule
change, allocation replay or account reparenting is authorized by this scope.

Recovery and the maintenance window are covered by the operator's confirmation.
A manual Neon snapshot was proposed, but its creation has not been confirmed.

## Runtime proof supplied by the operator

- Source commit: `ea22144fdee321b8972ffdf6ceff33c96bcfd2a7`.
- Migration image digest:
  `sha256:1fc6ed5b98c57ffc8f40c98a68cf9881e0cc5616cab816946a80c014333e9df5`.
- ECS task-definition family/revision: `sirius-migration:40`.
- Region: `us-west-2`.
- The operator's task-definition query confirmed the `migration` container
  references that immutable digest.
- Target environment: production S2, as designated by the operator.

## Retained staging evidence

Run `583`, daily mode, started `2026-10-15 07:02:18.462+00` and finished
`2026-10-15 08:29:28.27745+00`.

- Raw AR: source-before, source-after, extracted and staged counts were all
  `368329`; stale rows removed: `0`. No exact AR identity-set hash was retained
  in this report.
- Contacts: `133240` scanned/staged, identity verified, integrity/status pass,
  no accepted live drift.
- Payments: `4291` scanned/staged, identity verified, integrity/status pass,
  no accepted live drift.
- Workers: `119721` scanned/staged, identity verified, integrity/status pass,
  no accepted live drift.

These are retained run results, not a successful recomputation of the current
staged sets or proof that every staged financial row loaded.

## Separate live-source observation

An operator-run, read-only S1 query reported the AR table uses InnoDB, and
both all-AR and cleared-AR sets contained `368729` IDs. Serialization was
complete at `2581103` bytes, with SHA-256:
`5d09309427485423fb02787a03c4ceaa734ac0a216fe92e34e3e484e2895ce7f`.

This count is 400 greater than the earlier recorded staging count. It does not
identify which IDs differ, establish when differences arose, prove a loader
rejection or extraction defect, or authorize importing/excluding any rows.
The previously documented extra live-source AR observation also remains
separate; it has not been reconciled to this later observation.

The S2 query session reported `2026-10-15 20:50:08.092671` UTC, followed by a
reported JavaScript `map` error. No usable current S2 set-hash result was
returned. Neither query success nor an S1/S2 exact-set mismatch is established
by that error.

## Current-staging inventory baseline

Non-PHI label used:
`s2-prod-current-staging-run583-2026-10-15`.

This label identifies the revised current-staging scope; it is not evidence
of common historical S1/staging equality. The repair command's evidence hash,
not this label alone, binds the staged identity and target evidence.

### First read-only inventory

Operator-reported ECS task:
`arn:aws:ecs:us-west-2:142403088251:task/fc-web-server-4bcead-s7vk0xww/6bd002ff13f940248dab417a943ddaef`.

The report returned `wet: false`, exit code `0`, and evidence hash:
`0e4d252edd70ff382e1dfd7b945d473e03dda48ee640bf18518b39ea2d67e1de`.

| Classification | Count |
| --- | ---: |
| AR staged | 368329 |
| AR employer, already matched | 363292 |
| AR proven contact-worker, identity mismatch | 5037 |
| Payments staged | 4291 |
| Payment proven contact-worker | 1427 |
| Payment employer | 2864 |
| Payment already matched | 2851 |
| Payment identity mismatch | 1343 |
| Payment missing target | 97 |
| Attribution coordinates | 3550 |
| Attribution mismatches | 3178 |
| Unsafe identity/ownership blockers | 0 |
| Total link-repair candidates | 6380 |

The 97 missing payments are not link-repair candidates. Zero `blocked` does
not imply complete loading or explain those absences.

Startup also reported `LogsTransport` accessed before initialization. Source
inspection confirms this leaves the storage logger without its database audit
transport. Dry inventory performed no repair writes, but wet execution must
not silently rely on console-only audit logging.

A local import-only diagnostic confirmed that importing the logger first
attaches its database transport. On 2026-11-10 the operator also reported the
same result from the pinned production image. ECS task
`9580416c69164dda8447fe6ef130f655` used the recorded image digest, and its log
returned `auditTransportAttached: true`, `repairInvoked: false`. Its final exit
code was not supplied. Transport attachment is not proof of a persisted audit
entry or of repair execution.

At the probe stage, no new image or wet approval had been issued.
The subsequent approved repair disabled verbose storage console output while
retaining its database audit transport.

### Current-state read-only inventory, 2026-11-10

The operator reported another `wet: false` inventory at 16:02 UTC-05:00.
The operator later confirmed exit code `0`; this pre-repair dry task's ARN
was not supplied. Evidence hash:
`193dc954c008fa5f52f57a4d869250afeb4999ac14cd3ea517a77a74cc9ff9b5`.

| Classification | Count |
| --- | ---: |
| AR staged | 390238 |
| AR employer, already matched | 383790 |
| AR proven contact-worker, identity mismatch | 6448 |
| Payments staged | 4714 |
| Payment proven contact-worker | 1684 |
| Payment employer | 3030 |
| Payment already matched | 3008 |
| Payment identity mismatch | 1599 |
| Payment missing target | 107 |
| Attribution coordinates | 3788 |
| Attribution mismatches | 3414 |
| Unsafe identity/ownership blockers | 0 |
| Total link-repair candidates | 8047 |

The dataset differs from the October inventory. The reused checkpoint label
still mentions run 583, but it does not freeze staging or establish which
later sync changed it. This new evidence hash, not the October hash, is the
candidate approval baseline. The 107 missing payments are excluded from
link-only repair and remain unresolved.

These results prove current identity mismatches remain; they do not prove
whether a historical wet repair never ran, failed, or was later superseded.
The operator's CloudTrail lookup returned no usable wet-run evidence.

### Separate wet approval, 2026-11-10

The operator confirmed the latest dry task exited with code `0` and explicitly
approved only the current 8047-link plan under evidence hash:
`193dc954c008fa5f52f57a4d869250afeb4999ac14cd3ea517a77a74cc9ff9b5`.

Approval covers 6448 AR links and 1599 payment links, excludes the 107 missing
payments, and retains the approved staged-only scope. It assumes the
operator's recovery protection and maintenance arrangements are ready.
Changed evidence or unsafe identities must refuse the transaction.

The approved startup loads the logger first, refuses if its database audit
transport is absent, and removes other storage logger transports from this
standalone process to avoid verbose storage payloads in shared console output.
Database audit persistence and derived-state completion still require
post-run verification.

### Applied repair reported, 2026-11-10

The operator supplied an aggregate wet report at 16:29 UTC-05:00
(21:29 UTC). Its approved hash matches the separate approval exactly.
The entrypoint prints this report after the repair transaction returns, so
this establishes committed link correction. The operator subsequently confirmed
final exit code `0`, which establishes successful completion of the command's
shutdown/drain path, not completion of background recomputations. The operator
supplied the wet task ARN:
`arn:aws:ecs:us-west-2:142403088251:task/fc-web-server-4bcead-s7vk0xww/facd6c5e8b644ed5b8ebd2e7fb7ea91e`.

- `wet: true`, `rebound: 8047`.
- `blocked: 0`, `mismatched: 0`, attribution mismatches: `0`.
- AR: `390238` staged and matched, including `6448` proven contact-worker rows.
- Payments: `4714` staged, `4607` matched, `107` missing targets still unresolved.
- `financialFactsUnchanged: true`.
- Post-repair evidence hash:
  `9aa187dda498ab7ba0f215c05fc2e7d7429635328aee50ad3698ded6976f3c08`.
- Startup preflight reported database audit transport attached and storage
  console output disabled.

Exact fund totals returned by the preservation check:

| Stream | Fund account | Rows | Amount total |
| --- | --- | ---: | ---: |
| AR | `1ecbc3e5-1cc5-4999-a74b-d576b0d7db5b` | 6448 | 33978.25 |
| AR | `6a23cea9-06ed-4ed0-b1fa-6f8c8d35e7e4` | 309505 | 12961843.69 |
| AR | `adb21646-2ec8-4f8c-9305-007d44627410` | 74285 | 3591282.82 |
| Payment | `1ecbc3e5-1cc5-4999-a74b-d576b0d7db5b` | 1656 | 517777.75 |
| Payment | `6a23cea9-06ed-4ed0-b1fa-6f8c8d35e7e4` | 2816 | 244731203.58 |
| Payment | `adb21646-2ec8-4f8c-9305-007d44627410` | 135 | 2056425.01 |

The supplied report was parsed locally and its approved hash, rebound count,
zero identity/attribution blockers, invariant flag, and fund row-count
reconciliation were checked successfully. No remote database was queried by
the assistant.

### Independent post-repair dry run, 2026-11-10

The operator supplied the final aggregate report at 17:00 UTC-05:00
(22:00 UTC), confirmed exit code `0`, and supplied task ARN:
`arn:aws:ecs:us-west-2:142403088251:task/fc-web-server-4bcead-s7vk0xww/4d3c6c7713464a2db4a2b9279f11faf9`.

- `wet: false`, `blocked: 0`, `mismatched: 0`.
- Attribution mismatches: `0` across `2081` coordinates.
- AR: `390238` staged and matched; `6448` proven contact-worker rows.
- Payments: `4714` staged, `4607` matched; `107` missing targets remain excluded.
- Evidence hash:
  `9aa187dda498ab7ba0f215c05fc2e7d7429635328aee50ad3698ded6976f3c08`.

This exactly matches the wet transaction's final evidence hash and independently
confirms no remaining link corrections in the same staged-target evidence.
No second wet run was executed; do not claim a successful production
zero-change wet repeat was demonstrated.

### Post-run limitations identified in the pinned source

Source inspection at the exact pinned commit found that the standalone
entrypoint does not initialize the web application's WMB/DP auto-rescan
listeners. Ledger events alone therefore do not prove durable refresh work
was queued or completed. Old/new affected derived-state completion remains
unverified; waiting for a background queue is not proof that this standalone
process populated it. The operator subsequently ended further post-repair
checks, as recorded below.

Database audit transport attachment must not be confused with per-row audit
coverage: the pinned storage factory supplies no ledger-entry logging
configuration, and payment logging declares no `updateForMigration` hook.
Do not claim 8047 individual audit entries exist, or synthesize retrospective
entries as though they were captured at the original mutation. The approved
hashes and preserved aggregate wet report remain the operator execution proof.

### Operator closeout and daily-sync handoff

After the independent zero-mismatch dry run, the operator explicitly stopped
additional post-repair checks and requested assurance that the daily sync fleet
correctly links all future payments. This narrows the one-off acceptance to
the applied, hash-approved repair and the successful independent dry run.
It does not establish the omitted original proof requirements:

- Historical common-source/staging AR exact-set checkpoint equality.
- Successful zero-change wet repeat.
- Completed old/new derived-state refresh or signed-in worker-path visibility.
- Actual wet/dry task image digests from task metadata (the approved launch
  references immutable task definition revision `40`; the earlier startup
  probe separately confirmed the pinned digest).

The `107` staged payments without target records remain unresolved and were
not created or repaired. No retrospective per-row audit coverage is claimed.

The accepted dependent task **Ensure daily sync preserves and verifies worker
financial links** already explicitly covers new contact-shaped worker payments
resolving through the exact source worker mapping to the canonical worker/fund
account, scheduled-wrapper wiring, identity checks even when source content is
unchanged, unsafe-identity refusal, and regression tests. No duplicate task,
recurring historical repair, new deployment, or schedule change is needed or
authorized by this handoff. The historical repair itself must never become a
daily fleet step.
