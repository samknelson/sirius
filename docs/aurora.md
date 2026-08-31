# Running Sirius against AWS Aurora (or any plain PostgreSQL)

Sirius historically connected exclusively through the Neon serverless
driver, which speaks Neon's WebSocket proxy protocol and only works
against Neon endpoints. As of Task #670 the app also supports any plain
PostgreSQL server reachable over TCP — AWS Aurora PostgreSQL, RDS, or a
vanilla Postgres install — via `node-postgres` (`pg`).

This document covers the pieces an operator needs:

1. [Driver selection](#driver-selection) — how the app decides between
   the Neon driver and `pg`, and how to override it.
2. [Bootstrapping an empty database](#bootstrapping-an-empty-database)
   — how to initialize a brand-new, completely empty database (e.g. a
   freshly provisioned Aurora cluster) with the full Sirius schema.
3. [Diagnosing a deployment with no shell](#diagnosing-a-deployment-with-no-shell)
   — what to do when a deployed image refuses to boot and the only
   levers you have are environment variables and a redeploy.

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
- `npm run db:push` (`scripts/db-push.ts`) reuses the shared pool from
  `server/storage/db.ts`, so it follows the same driver selection
  (Neon vs `pg`, `DATABASE_DRIVER` override, `sslmode` handling) and
  works against Aurora / plain Postgres too. It is still a dev-only
  DDL-preview escape hatch gated behind `ALLOW_DB_PUSH=1`; all schema
  changes ship as migrations (see `replit.md`).

## Diagnosing a deployment with no shell

On a deployed target (ECS, a managed container platform, anywhere you
cannot get a terminal) the only things you have are the deploy/build
output, the environment variables the pipeline injects, and the ability
to redeploy. Everything below is designed for exactly that: **read the
log or the browser, set a variable, redeploy.** No step asks you to run
a command on the target.

### The bring-up report

Every boot prints one delimited block before the app serves traffic —
on a successful boot too, not only on failure:

```
==============================================================================
SCHEMA BRING-UP REPORT
==============================================================================

-- Database ------------------------------------------------------------------
  host:       my-cluster.cluster-abc123.us-east-1.rds.amazonaws.com:5432
  database:   sirius
  user:       sirius_app
  driver:     pg (node-postgres/TCP)
  tls:        enabled (server certificate NOT verified)
  url source: assembled from DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_SECRET
  state:      INITIALIZED (this app's `variables` table is present)
  tables:     193 in the public schema

-- Core migrations (migrations_version) --------------------------------------
  stored version:            1052
  highest registered:        1060
  highest baseline script:   1042
  pending (8):
    - 1053  create_help
    ...
```

followed by per-component migration versions and the drift-gate result.
It contains no credentials. Read it first — it answers "is this even
the right database", "did the migrations run", and "how far did it get"
without any access to the target.

If the deploy log is hard to reach, set `EXPOSE_BOOT_ERRORS=1` and the
same report is served over HTTP as `bringUpReport` by the boot-status
addresses below. Without the flag those addresses still name the state
and the blocker; only the error text, the stack and the report are
withheld. Do not leave `EXPOSE_BOOT_ERRORS=1` set on a public production
deployment.

### The boot-status addresses

Four addresses answer the same thing, in every state, from the first
moment the process is listening:

| Address | Reaches |
| --- | --- |
| `/health` | the UI service (historic; also the container/target health check) |
| `/boot-status` | the UI service, on a path no load-balancer health rule occupies |
| `/api/health` | **the API service** |
| `/api/boot-status` | **the API service**, on a path no health rule occupies |

Why four: one image runs as TWO services behind a single ALB — `/*`
routes to the UI service and `/api/*` to the API service — so a status
endpoint on a root path only ever answers for the UI service, and a
fixed-response ALB rule on `/health` can shadow even that. The `/api/…`
spellings are the only way to read the API service's boot state, which
is the service a wedged deployment usually fails on.

They always answer HTTP 200 (deliberately — the task must stabilize and
stay observable rather than be cycled), with a browser page for a
`text/html` request and JSON otherwise:

```json
{ "status": "init-failed", "message": "Initialization failed and this process will NOT recover…",
  "blockedOn": "migrations", "driftCheck": "not-run",
  "bootId": "…", "startedAt": "…", "path": "/api/boot-status", "details": "withheld" }
```

- `status` is one of `starting`, `ready`, `init-failed`, `report-only` —
  the first will change on its own, the last two never will.
- `blockedOn` distinguishes a boot blocked on `database`, `migrations`
  or `drift` from an ordinary `other` startup failure.
- `bootId` / `startedAt` identify the process, so two rolled tasks can be
  told apart.

Every OTHER request to a not-ready process gets the same body with the
same fields, as HTTP 503 (the root path stays 200). So a plain
`/api/anything` call on a wedged deployment says *why* it is not being
served instead of claiming the app is starting.

### Step 1 — look without touching: `BRINGUP_REPORT_ONLY=1`

Deploy with:

```
BRINGUP_REPORT_ONLY=1
```

The process connects, classifies the database, reads the migration
bookkeeping, runs the drift check read-only, prints the report, and
**stops**. It applies no migration, creates no schema, and writes no
variable — safe against a database you are not sure about. The app does
not start; the boot-status addresses report `report-only` (and serve the
report under `EXPOSE_BOOT_ERRORS=1`), and so does every other request.
Remove the variable to boot normally.

### Step 2 — read the `state:` line

- **INITIALIZED** — this is a Sirius database. Go to step 3.
- **EMPTY** — the deployment is pointed at a database with no tables.
  Either a wrong `DB_NAME`/`DB_HOST` (fix the pipeline variable), or a
  genuinely new database (see
  [Bootstrapping an empty database](#bootstrapping-an-empty-database)
  and set `ALLOW_EMPTY_DB_BOOTSTRAP=1` for one deploy).
- **PARTIALLY INITIALIZED** — tables exist but none of them are this
  app's. Almost always the wrong database. Check the `host:`,
  `database:` and `url source:` lines: when the URL was assembled from
  parts, a single wrong `DB_*` value is enough to land here.

### Step 3 — read the failure

- **A migration failed.** The boot stops at that migration and prints
  its version, name and the underlying error. That error is the fault;
  fix its cause and redeploy. The app deliberately never reaches the
  drift gate on a half-migrated database, because the drift report is
  only the symptom.
- **The drift gate failed.** The error correlates every drift item
  against the registered migrations (by migration name and description)
  and tells you which of three situations you are in:

  - **A — pending migrations cover the items.** They will apply on the
    next boot. If the boot reached the drift gate with them still
    pending, look above for the migration error that stopped them.
  - **B — the stored version is ahead of the schema.** The migrations
    are recorded as applied but their result is not in the database —
    what an empty-database bootstrap, a restored dump, or a hand-edited
    variable leaves behind. The message names the exact variable and
    value; see step 4.
  - **C — no registered migration covers the items.** No environment
    variable can fix this: nothing in the image knows how to create
    them. A baseline script has to ship in the **next image** — see
    [docs/baselining.md](./baselining.md).

### Step 4 — repair a stamp-ahead database

Deploy once with the value the drift message printed, e.g.:

```
MIGRATIONS_RESUME_FROM_VERSION=1052
```

On the next boot this sets the stored `migrations_version` to that
number, logs the change as a one-shot recovery, and lets every
registered migration above it re-apply. Any failure during the replay
stops the boot naming that migration and quoting its error.

Replay works because a core migration checks for its own work before
doing it — `IF NOT EXISTS`, or an `information_schema` probe that
returns early — so re-applying one over schema that is already correct
is a no-op. That is a convention, though, not something the runner can
verify. **If a replayed migration fails because its work is already
present**, set the same variable to *that migration's* version:

```
MIGRATIONS_RESUME_FROM_VERSION=1057
```

Raising the stamp declares every migration at or below that version
applied — they will never run on this database — and resumes the replay
above it. It is logged as loudly as the lowering, for the same reason:
nothing checks the claim. Use it only when the failing migration's work
is verifiably present in the report you just read, and repeat if a later
one wedges the same way. Without this direction a wedged replay would
need database access to undo, which is the one thing the target does
not have.

**Remove the variable once the boot succeeds.** Left in place it sets
the stamp on every restart and replays the same migrations forever. It
is never inferred and never defaulted: nothing sets it but you.

### Step 5 — when a baseline is needed

Case C means the image is missing DDL for this database. Write the
baseline on a machine you *do* have a shell on, following
[docs/baselining.md](./baselining.md), using the drift items from the
report you just read; register it with a version **below** the highest
ordinary core migration (the app refuses to start otherwise, because
the empty-database bootstrap stamps the highest registered version and
would permanently retire anything above it), and ship it in the next
image.
