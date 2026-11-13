# Retired call communications

Calls and visits belong in worker Notes. There is no historical interaction
compatibility mode or conversion workflow. SMS, email, postal, in-app and
offline communication history remain supported.

## Upgrade

Registered core migration **1220**, above the previous 1219 floor, removes
`comm_interaction` before `options_call_reason`. Earlier migration definitions
remain intact for historical replay; the final current schema has neither
table. Fresh databases use the existing empty-database bootstrap and current
schema, not a schema push.

Before either drop, a single PostgreSQL transaction locks the comm parent
and interaction child tables and counts **all** child records and **all**
parents whose medium is `interaction`. Either nonzero count refuses the
upgrade with both aggregate counts. It does not delete records or advance the
version. Operators must investigate unexpected records rather than bypass
this check. Missing tables and successful replays are safe. There is no
`CASCADE` and no deletion of unrelated audit, metadata, or migration records.
Development checkpoint rollback covers recovery from unintended development
changes; external production recovery is managed by its database provider.

## Import and runtime boundaries

- The active S1 sync entry remains `load-log-notes.ts`. Approved log
  classification, note types and BAO tags are unchanged.
- `load-call-logs.ts`, its private communication reconciliation operations,
  call-reason seed and obsolete call-log trap helper are retired.
- Bootstrap no longer seeds call reasons. The combined status smoke script
  retains its member-status create, update, empty-set and deletion checks.
- Enrollment-packet receipts remain parent-only offline communications.
- Old manual interaction POST requests still receive 410. Old Log Call
  browser URLs still redirect to protected history.

## Verification evidence

The accessible development database initially contained **0 interaction
children, 0 interaction parents, and 6 call reasons**. This is development
evidence only: no external production database was inspected or modified,
and no production emptiness is inferred.
After the normal application restart, migration 1220 ran successfully,
the schema drift gate passed, both retired tables were absent, and the
interaction-parent and verification-contact counts were both zero.

One-time real PostgreSQL verification used a disposable database with
synthetic fixtures through the supported bootstrap and registered migration
runner. It established:

- Fresh initialization omits both retired tables and stamps version 1220.
- An empty old model upgrades and replays safely.
- Parent-only, child-only (including a child on a non-interaction parent),
  and combined unexpected records refuse with exact aggregate counts,
  unchanged tables and records, and an unchanged migration version.
- Ordinary history and detail reads work for SMS, email, postal, in-app and
  offline parents without the retired response field.

The first verification connection inherited a connection string that
overrode its separate database-name setting and reached development.
Its three synthetic contact fixtures and their three communications/two
children were removed after confirming ownership by aggregate counts.
The corrected disposable connection explicitly verified `current_database()`
before any fixture writes; all seven one-time checks then passed.
The one-time harness was removed rather than added to every build.

All **63 focused tests** passed, covering the existing tombstones, supported
history links, medium contracts and active S1 note classification. Client
and production-server bundle builds passed without invoking schema push.
The running app returned 410 for the retired POST endpoint.
The repository scripts
typecheck has pre-existing `cronJobRuns` references in
`scripts/oneoffs/smoke-s1-write-fence.ts`; these are unrelated to call removal.
Excluding only that existing failing script, the scripts typecheck passed.

## Built-in help

`system:communication-history` now explains that calls and visits go in worker
Notes and that Call Reasons is no longer offered. Its registration, sanitized
content, listing data and history/detail path matching were verified, including
unrelated-page exclusions. The existing worker-records help contains no call
communication instructions to remove. No administrator-authored help was
changed. Signed-in help dialogs and communication pages were not visually
verified; source, registry and database checks are not a browser verification.
