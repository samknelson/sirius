# Running Sirius against AWS Aurora (or any plain PostgreSQL)

Sirius historically connected exclusively through the Neon serverless
driver, which speaks Neon's WebSocket proxy protocol and only works
against Neon endpoints. As of Task #670 the app also supports any plain
PostgreSQL server reachable over TCP — AWS Aurora PostgreSQL, RDS, or a
vanilla Postgres install — via `node-postgres` (`pg`).

This document covers the two pieces an operator needs:

1. [Driver selection](#driver-selection) — how the app decides between
   the Neon driver and `pg`, and how to override it.
2. [Bootstrapping an empty database](#bootstrapping-an-empty-database)
   — how to initialize a brand-new, completely empty database (e.g. a
   freshly provisioned Aurora cluster) with the full Sirius schema.

Out of scope: migrating existing data between databases, AWS
infrastructure provisioning, and production cutover procedures.

## Driver selection

`server/storage/db.ts` picks a driver automatically from
`DATABASE_URL`:

| Connection string host        | Driver used                              |
| ----------------------------- | ---------------------------------------- |
| contains `.neon.tech`         | `@neondatabase/serverless` (WebSockets)  |
| anything else (Aurora, RDS, …)| `pg` (node-postgres, plain TCP)          |

The exported `db` / `pool` surface is identical either way — no other
code changes are needed when switching databases.

### Overriding detection

Set `DATABASE_DRIVER=pg` or `DATABASE_DRIVER=neon` to force a driver.
This is useful for:

- Connecting to a Neon database over plain TCP (Neon endpoints speak
  both protocols): `DATABASE_DRIVER=pg`.
- Any custom DNS/proxy setup where the hostname does not reveal the
  server type.

### TLS / `sslmode`

When the `pg` driver is used, SSL behavior is derived from the
`sslmode` query parameter in `DATABASE_URL`:

| `sslmode`                  | Behavior                                  |
| -------------------------- | ----------------------------------------- |
| `disable`                  | No TLS                                    |
| `require`, `no-verify` (or omitted) | TLS, certificate **not** verified |
| `verify-ca`, `verify-full` | TLS, certificate verified                 |

Aurora/RDS servers present certificates signed by the AWS RDS CA, which
is not in Node's default trust store. For full verification use
`sslmode=verify-full` **and** point `NODE_EXTRA_CA_CERTS` at the
[AWS RDS CA bundle](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).
For a first bring-up, `sslmode=require` (encrypted, unverified) is the
pragmatic starting point.

Example Aurora connection string:

```
DATABASE_URL=postgresql://sirius_app:PASSWORD@my-cluster.cluster-abc123.us-east-1.rds.amazonaws.com:5432/sirius?sslmode=require
```

## Bootstrapping an empty database

A brand-new database has none of the ~150 tables Sirius needs, and the
migration framework alone cannot create them — migrations assume the
core schema already exists (the migration runner itself stores its
version in the `variables` table).

The empty-database bootstrap
(`server/services/empty-db-bootstrap.ts`) closes that gap. At startup,
before anything else touches the database, the app checks its state:

- **Initialized database** (a `variables` table exists): bootstrap is a
  strict no-op. Normal startup continues.
- **Empty database** (zero tables in the `public` schema) **without**
  the flag: startup fails with a clear error telling you to either set
  the flag (if the empty database is intentional) or fix
  `DATABASE_URL` (if it is not).
- **Empty database with `ALLOW_EMPTY_DB_BOOTSTRAP=1`**: the app creates
  the full schema and initializes migration bookkeeping, then continues
  with normal startup — including the schema drift gate, which
  independently verifies that the created schema matches the expected
  one exactly.
- **Partially initialized database** (some tables, but no `variables`
  table): startup fails. Bootstrap refuses to touch a database it
  cannot classify; clean it out or point at a different database.

### What bootstrap creates

- Every enum and core table defined in `shared/schema.ts` (tables owned
  by schema-managing components are excluded from the core set), with
  all constraints, foreign keys (created in dependency order), and
  indexes — generated from the same Drizzle definitions and DDL
  machinery the component enable flow uses.
- The tables of every **default-enabled** schema-managing component,
  plus their `component_schema_state_<id>` bookkeeping variable.
  Components that are not enabled by default get their tables created
  later, when an admin enables them (the normal enable flow).
- The `migrations_version` variable, stamped to the highest registered
  core migration version. Historical migrations (including
  per-deployment baseline scripts) never replay against a
  freshly created schema — it is already current.

### Procedure

1. Create the database and a login role for the app. The role must be
   able to create tables in the `public` schema of that database.
2. Set the environment:

   ```
   DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
   ALLOW_EMPTY_DB_BOOTSTRAP=1
   ```

3. Start the app. Watch the logs for:

   ```
   Empty database detected — bootstrapping full schema (ALLOW_EMPTY_DB_BOOTSTRAP=1)
   Empty-database bootstrap complete
   ```

   followed by the normal startup sequence (migrations: nothing
   pending; drift gate: passes).

4. **Remove `ALLOW_EMPTY_DB_BOOTSTRAP=1`** once the first boot
   succeeds. Bootstrap is a no-op on an initialized database, but the
   flag should not be left set: if `DATABASE_URL` were ever
   misconfigured to point at an empty database, the flag would silently
   build a fresh schema there instead of failing loudly.

### Notes

- Bootstrap creates schema only — no data. Seeding users, employers,
  etc. is a separate concern.
- The drift gate remains the authority on schema correctness. If
  bootstrap ever produced a schema that drifts from the Drizzle
  definitions, the app would refuse to boot, exactly as it would for
  any other drift.
- `npm run db:push` (`scripts/db-push.ts`) remains Neon-only and is not
  part of any supported flow for Aurora databases. All schema changes
  ship as migrations (see `replit.md`).
