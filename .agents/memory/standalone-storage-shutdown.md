---
name: Standalone storage shutdown
description: Why standalone migration processes must drain deferred storage side effects before closing their database pool.
---

Standalone scripts that mutate through wrapped storage must drain deferred
entity-metadata work and database-backed Winston writes before calling
`pool.end()`.

**Why:** storage mutations return before their audit and default metadata work
finishes. Closing NeonPool first causes those callbacks to use an ended pool;
the Neon driver can then crash the process after the business writes and seed
verification already succeeded.

**How to apply:** every standalone migration entry point that closes the pool
after storage writes must call the shared drain helper first on both success
and failure shutdown paths. Direct-SQL-only scripts do not need it unless they
also emit through the database-backed storage logger.