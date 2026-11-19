---
name: PostgreSQL verification target identity
description: Prove disposable database identity before any test fixture writes.
---

When creating a disposable PostgreSQL test connection from existing pool
options, do not assume a separate `database` option overrides an inherited
`connectionString`. Rewrite the connection string's database path too, then
assert `current_database()` matches the intended disposable name before any
schema or fixture mutation.

**Why:** node-postgres gives the connection string precedence; an otherwise
plausible isolated harness can reach development instead. A newly created
database does not prove that the next connection uses it.

**How to apply:** Any one-time bootstrap/migration verification that derives
connection options from an existing pool must positively check the connected
database identity. Keep fixtures synthetic and cleanup scoped to their exact
ownership, and never log connection strings.

Local query success is not proof of the cause of a remote failure. Keep
synthetic timing, development data and staging verification explicitly separate;
do not infer a timeout or identifier-type mismatch from Drizzle's outer
SQL-and-parameters error alone.

**Why:** A reported EDI readiness failure could not be reproduced with either
one or two maintenance configurations, including a large synthetic population.
The outer wrapper did not include the nested PostgreSQL cause, so a speculative
SQL or schema change would not be evidence-based.

**How to apply:** Capture the nested SQLSTATE with a safe phase and reference
before changing query plans or database prerequisites. Never log driver
message/detail or raw wrappers as diagnostics; those may contain record data.
