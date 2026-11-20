# Denorm plugin contract

A denorm plugin keeps a precomputed (denormalized) copy of an entity's data
in sync. The full type-level contract lives in `types.ts` (`DenormPlugin`);
this README covers the parts an author must get right beyond the types,
especially the **storage declarations** introduced with the relationships
framework.

Registration follows the standard plugin-framework convention
(`server/plugins/_core/README.md`): each plugin file self-registers via
`registerDenormPlugin(...)` at module top level, and `index.ts` imports it
as a side-effect import.

## Continuous spans and companion issues

`denorm_span` and `denorm_issue` are optional payload forms, not a second
scheduler. Each row belongs to one `denorm.id`, hence one entity/plugin config.
Dates are first-of-month boundaries; span `last_month` is inclusive and never
independently proves termination. `subject_id` and JSON semantics belong to the
producer. Indexes support owner replacement and subject/month or ending lookups.
The coverage producer's typed payload and reason codes live in
`shared/coverage-span.ts`; carrier semantics must not enter this framework.

Write both stores through `createDenormSpansStorage().replace()` inside
`applyComputed`. Keep the status spine when replacing payloads, so generations
remain monotonic. IDs of payload rows are rebuild-unstable; consumers fingerprint
stable facts plus generation/freshness, never payload IDs. A failed write rolls
back both stores and status together. Missing/stale/error status means unusable
payload even if previous rows remain. Disabled configs pause computation, not
source invalidation. `invalidateOnConfigChange` enqueues existing statuses
without deleting their generation.

The initial worker coverage producer uses the existing worker anti-join backfill,
bounded denorm drain, error/rebuild controls and widow cleanup. Worker/contact
deletions also remove its status in the source transaction, cascading payloads.
Readiness enumerates the authoritative worker population, including workers whose
computed answer is empty; an empty payload table is not a readiness signal.

## Required storage declarations (`reads` / `writes`)

Every plugin MUST declare, at **storage-object granularity** (the property
name on the `storage` aggregate, or the lowerCamel interface name for
factory-only storages — never a table name):

- `reads: string[]` — every storage namespace its `compute` / `backfill` /
  `findWidows` / `isScheduledEventLive` / event handlers query.
  Example: `["workers", "workerMsh"]`.
- `writes: { storage: string; soleWriter: boolean }[]` — every storage
  namespace it mutates, each with an ownership claim.

The framework's own bookkeeping namespaces (`denorm`, `pluginConfigs`) are
implicit — the wrapper routes every plugin through them — and must NOT be
declared.

Dispatch plugins share their write path through `plugins/dispatch/_shared.ts`;
usage inside those shared helpers counts toward every plugin that imports
them.

### `soleWriter` semantics

- `soleWriter: true` claims that **nothing else in the codebase** mutates the
  storage object — no other plugin, module, cron, or script. This is the
  right claim for a wholly-owned `_denorm` payload store (e.g.
  `workerMshDenorm`).
- `soleWriter: false` marks a **shared target** — several writers converge on
  it. Current examples: `ebs` (three reminder plugins + the `ebs_pump` cron +
  the EBS admin module), `workerDispatchEligDenorm` (ten dispatch plugins
  via `_shared.ts`), and `workerBans` (the `worker_ban_active` plugin owns
  only the cached `denorm_active` column; regular storage writes own the rest).

### Shared targets must be written convergently

Writes to a `soleWriter: false` target MUST be convergent:

- **Diff-check first, no-op when already correct.** Compare against the
  current stored state and skip the write when nothing changes (the EBS
  `replaceForEntity` pattern).
- **Normal storage mutation paths only** — never bespoke SQL, never a
  side-channel. All mutations go through `server/storage/` methods like any
  other write.
- **Re-runnable at any time.** The framework recompute (backfill sweep, stale
  sweep, manual "recompute" from the admin page) may re-run `compute` +
  `write` for any entity at any moment, concurrently with other writers.
  A convergent write makes that safe; a non-convergent one corrupts shared
  state.

## Enforcement

`scripts/dev/check-denorm-declarations.ts` (the `denorm-declarations` rule in
the architecture-lint suite — `npm run lint`, registered as the `lint`
validation alongside `typecheck` and `migrations`) fails the build when:

1. A plugin uses a storage namespace not declared in `reads`/`writes`, or a
   mutating-looking call (`create`/`update`/`delete`/`replace`/`upsert`/
   `set`/`insert` prefixes) targets a namespace not in `writes`.
2. A declaration is unused (declarations must stay honest).
3. A `soleWriter: true` claim is violated anywhere in `server/` or
   `scripts/` (outside the storage layer itself), or two plugins claim sole
   ownership of the same namespace.

Plugins that construct storages via factories (`createWorkerBanStorage()`
etc.) are tracked through the lint's `FACTORY_NAMESPACES` map — extend it
when a plugin starts using a new factory.

## Configured, source-owned derivations

The framework passes the **same resolved configuration** to `compute`,
`backfill`, and `findWidows`. Event dispatch and sweeps process every enabled
configuration, while keeping the existing per-plugin sweep limits and summary
shape. Singleton plugins can continue ignoring the extra argument.

A plugin may opt into `replaceOnCompute` for a derivation owned by its source
record. The shared apply transaction deletes the previous status (cascading to
its payload), then creates/writes the replacement. A `null` computation removes
the old derivation without creating a new status. Existing plugins retain their
in-place semantics, including their existing interpretation of null payloads.
Updating a source-owned configuration clears its statuses; ordinary backfill
rebuilds them with the new configuration. Configuration deletion uses the
existing configuration-to-status FK cascade.

`workerBadgeFromNote` uses the note ID as its entity ID. Its unique worker/badge
claim never overwrites another note's award. Backfill therefore looks for a
missing **award**, not just a missing status: a previously processed, losing note
can re-grant after the owning note disappears. Cleanup includes sources that no
longer qualify, and invalid source/payload relationships left by missed events.
There is no aggregate note count, retained revocation, or immediate handoff.

The rule is configured at `/admin/plugin-configs/denorm` after enabling
`worker.badges`. Note types must apply to Workers; badge types are managed through
the unified `worker-badge-type` options list.

## Reviewing relationships

`GET /api/denorm/relationships` (admin-gated, registry-only) serializes every
plugin's trigger events, reads, and writes; the **Relationships** page at
`/admin/denorm/relationships` renders them per plugin and cross-referenced per storage
object ("who reads / who writes X"). Use it to review data-flow chains when
adding a plugin — there is deliberately no automated cycle lint, because
legitimate component-gated cycles exist across site-specific plugins.
