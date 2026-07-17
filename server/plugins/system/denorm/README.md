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
  the EBS admin module) and `workerDispatchEligDenorm` (ten dispatch plugins
  via `_shared.ts` + the `sweep-expired-ban-elig` cron).

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

`scripts/dev/check-denorm-declarations.ts` (registered as the
`denorm-declarations` validation, alongside `typecheck`,
`storage-encapsulation`, etc.) fails the build when:

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

## Reviewing relationships

`GET /api/denorm/relationships` (admin-gated, registry-only) serializes every
plugin's trigger events, reads, and writes; the **Relationships** view on
`/admin/denorm` renders them per plugin and cross-referenced per storage
object ("who reads / who writes X"). Use it to review data-flow chains when
adding a plugin — there is deliberately no automated cycle lint, because
legitimate component-gated cycles exist across site-specific plugins.
