---
name: Storage logging before/after hooks are name-conventional
description: The storage logging middleware synthesizes before/after state only for create*/update*/delete* method names; other names silently get an undefined beforeState.
---

The logging middleware synthesizes `before` / `after` hooks **only** for method
names starting with `create`, `update`, or `delete` (plus the `*Many` / `bulk*`
family). Any other name — `setX`, `clearX`, `upsert`, `markAsY` — gets none,
regardless of `state: { key }`, `getter`, or `hostEntityIdField`.

**Why:** the middleware refuses to guess for unconventional names because it
cannot assume `args[0]` is a row id — for these methods it is usually a
parent/host id, so guessing would fetch the wrong row.

The failure is silent: `getDescription` still runs, it just receives
`beforeState === undefined`. So a description branching on the previous row
always takes the falsy branch — every replacement logs as a first-time create —
and `meta.before` / `meta.changes` never appear.

**How to apply:** for such methods, spell out `before` and `after` explicitly,
using the same wrapper key as the module-level `state.key` or `changes` won't
pair the halves. The middleware hands `getDescription` the very object it
persists, so a redacted projection serves both (see
[Credential redaction](audit-log-credential-redaction.md)).

Verify against the persisted row, not the console line. Note `module`,
`operation`, `entity_id`, and `host_entity_id` are **top-level columns** on
`winston_logs`, not fields in `meta` — filtering on `meta->>'host_entity_id'`
returns nothing and looks like "no audit rows were written".
