---
name: Post-merge verification
description: Why a merged task branch can leave the running app broken in two silent ways — a stale dev process, and a registration that vanished without failing boot.
---

# Post-merge verification

## Restart the app after a task merge, before believing anything you see

The dev server keeps running across merges. A module the merge **deleted** stays
resolvable in the loaded module graph, so the process looks healthy — until a
handler that imports it *lazily* (`await import(...)` inside a route) runs and
throws "Cannot find module" at request time, long after boot.

**Why:** a lazy import resolves on first call, not at load, so deletion of its
target produces a per-feature failure with no boot signal and no log line.

**How to apply:** after any merge lands, restart the app and read the fresh log
before diagnosing a user-reported error. A module-not-found for a path that
`rg` cannot find anywhere in the tree means the process is stale, not the code
broken. Note the log-file rotation: `ls -t /tmp/logs` may still show the old
file immediately after a restart; refresh logs to get the new one.

## Plugin registries fail loudly on duplicates and silently on absences

A merge can overwrite one registration block with a copy of its neighbour. If
the copy collides, the registry throws `already registered` and boot dies — the
lucky case. If a block is merely dropped, **everything still boots**: the kind
just disappears from the catalog, the Template Studio offers no fields for it,
and stored tokens against it stop resolving. The notifier author-time checks
pass either way, because they validate the templates that exist, not that every
kind still has a descriptor.

**Why:** registries assert uniqueness, never completeness; no check owns "this
kind must exist".

**How to apply:** when a merge touches a registry file, diff the *registered ids*
against the pre-merge revision (`git show <pre>:<file> | rg 'id: "`), or compare
the boot log's registered-plugin list across the merge — the boot log prints the
full list per registry, which makes an absence visible in one glance.

## A merged schema change can leave main unbootable — and two tasks may race to repair it

Two adjacent merges left main failing the startup drift gate: one added a
component migration file but never imported it from `scripts/migrate/index.ts`
(the file existed, nothing registered it), the next added tables + a column to
`shared/schema` with no migration at all and without listing the new tables in
the component's `schemaManifest.tables`. Every task branched from that main
inherited an app that would not boot, and two of them independently wrote the
same repair (same migration number), which collide at merge time.

**Why:** the drift gate only runs at boot, the migrations gate compares against
a base that already contains the offence, and nothing asserts "every file
under `scripts/migrate/components/*/` is imported".

**How to apply:** when the first boot on a fresh task branch fails at
`phase: drift-gate` naming tables you never touched, it is inherited — before
writing the repair, check the task list for an IMPLEMENTED/IN_PROGRESS task
that owns it ("…tables get created when the component is installed…"); if one
exists, prefer waiting for / rebasing onto it, and if you must repair to
proceed, make the migration idempotent (IF NOT EXISTS + pg_constraint checks)
and say in `drift_reason` which task duplicates it so the second to land drops
its copy (index import, file, manifest bump). Check `scripts/migrate/index.ts`
imports every component migration file whenever one is added.
