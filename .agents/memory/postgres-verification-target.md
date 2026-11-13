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
