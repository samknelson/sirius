---
name: Storage logging wrapper semantics
description: Why wrapping a storage implementation with withStorageLogging at its factory logs one entry per external call and never double-logs internal self-calls.
---

A storage module's logging config only reaches the admin log viewer if the
implementation is actually wrapped — a defined-but-unreferenced logging config
is dormant, and its module never appears in the viewer's module filter (that
filter is built from the distinct module values already in the log table, so
there is no allow-list to add the module to).

Wrapping at the factory is safe: the wrapper invokes the underlying method with
`this` bound to the *unwrapped* implementation, so internal `this.list()` /
`this.get()` calls inside a method go straight to the impl and produce no extra
entries. Methods with no logging config are bound through untouched.

**Why:** this is what makes it correct to wrap a whole storage object once,
rather than sprinkling log calls per write path. A bulk operation that loops
over the storage methods then gets exactly one audit entry per record, matching
what a hand edit produces — no bulk-specific logging code.

The same binding cuts the other way: a *batch* method that lives on the storage
module itself (`upsertBatch(parentId, rows)` looping `this.upsert`) reaches the
unwrapped impl, so it produces one entry for the batch and none for the records
— and no per-record provenance either. There is no way to fix that from inside
the config; the loop has to move out to the caller, which holds the wrapped
object. A batch convenience method is usually a four-line loop with one caller,
so deleting it costs nothing.

**How to apply:** when a bulk/import path must appear in the log viewer "as if
edited by hand", wrap the storage impl at its factory and route the bulk writes
through the same storage methods the single-record routes use — from OUTSIDE
the storage object. Before/after state is only synthesized for `create*` /
`update*` / `delete*` method names (see storage-logging-hook-name-conventions),
and an `upsert` is always classified `modified`, so a record first created by
one carries a creation date but no creator.
