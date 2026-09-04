---
name: Entity-files adapter is a fork extension
description: Upstream's entity-files framework is shared-table only; the BAO fork keeps an opt-in per-context adapter (own tables) — re-add it on every upstream merge, plus the token-precedence and attach-contract rules.
---
Upstream (`origin/main`) entity-files persists every attachment in one shared
`entity_files` table. The BAO fork keeps an OPT-IN adapter model on
`EntityFileContext` (`adapter?`, `tokens?`, `resolveTokens?`) so DC and case
documents live in their own tables with their own lifecycle rules.

**Rules**
- Every generic surface must branch on `context.adapter`: list/attach/update/
  remove routes, `getByFileId`, orphan sweep, the table-binding assert, and
  delete-cleanup all skip or delegate for adapter contexts.
- `attach` receives an UNPERSISTED `InsertFile`; the adapter's storage method
  must insert the `files` row and the join row in one transaction.
- Context-declared directory tokens expand BEFORE the framework `:entity-id`
  (the `bao-case` context redefines `:entity-id` as the parent record).
- `/api/entity-files/contexts` reports `tokens` and the config page renders them.

**Why:** upstream deleted the adapter when it moved to the shared table; the
merge silently compiled with the BAO contexts dead. Re-adding the adapter is a
judgment call — tell the user each time.

**How to apply:** on any upstream merge touching `server/services/entity-files/*`
or `server/modules/entity-files.ts`, diff against this list before declaring
the merge done.
