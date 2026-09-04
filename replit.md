# Sirius

Sirius is a full-stack web application designed for comprehensive worker management, streamlining administration, enhancing user experience, and delivering business value through efficient operations.

## Run & Operate

-   **Starting the project runs the app, and nothing else.** No check runs
    alongside it.

-   **Automated gates — exactly three** (registered validations, run on
    every task completion; no manual invocation needed):

    | Gate | Command |
    | --- | --- |
    | `lint` | `npx tsx scripts/dev/lint.ts` |
    | `typecheck` | `npm run check` |
    | `migrations` | `npx tsx scripts/check-migrations.ts --base=origin/main` |

    A violation blocks completion with the underlying check's own
    actionable error. `check-migrations` also sees untracked files
    (`git ls-files --others`), so a freshly written migration counts before
    it is committed.

-   **`npm run check` is tsc, run twice** — once for
    `tsconfig.server.json` (server + shared + tests) and once for
    `tsconfig.client.json` (client + shared), each in its own Node process
    with an explicit `--max-old-space-size`. Those are entry roots rather
    than an exclusive split — imports pull files across the line either way
    — and between them the two halves resolve to exactly the file set the
    root `tsconfig.json` does. The root config stays the one the editor,
    vite and vitest read. Both halves are incremental (a build-info file
    each), so re-runs are fast.

    The split and the pinned ceiling are not cosmetic: one combined process
    needs ~2.2 GB of heap, which is over the ~2.08 GB default a stock CI
    runner gives Node, so the check died there with "Reached heap limit"
    while passing locally. Heap by half, measured 2026-08-24: server
    1.48 GB, client 1.86 GB (peak RSS 0.9 / 2.0 GB). The client half is the
    expensive one because `@shared/schema` brings drizzle's inference in
    with it. Growth is steady — roughly +0.6 GB per 1,000 files added over
    the last year — so expect to raise the pin again rather than to hold
    this line forever. Raise it deliberately; do not go back to inheriting
    whatever the machine happens to allow.

-   **`npm run lint` is the architecture-lint suite** — one entry point for
    every repo-wide architecture rule (`scripts/dev/lint.ts`). It runs all
    fifteen rules and reports **every** violation in one pass rather than
    stopping at the first, each with its own fix instructions:
    `env-registry`, `storage-encapsulation`, `denorm-declarations`,
    `html-utils`, `constraint-names`, `component-table-order`,
    `component-manifest-coverage`, `core-migration-component-tables`,
    `lockfile-registry`, `main-branch-files`, `carrying-branch-drift`,
    `maintenance-guards`, `theme-color-vars`, `date-formatting`,
    `browser-timezone`. Run one rule
    with `npx tsx scripts/dev/lint.ts <rule-id>`, list them with `--list`.
    A new repo-wide rule is added to the `RULES` table in that file — never
    as its own workflow.

-   **`npm test` is the test suite** (Vitest; `npm run test:watch` to
    watch). Tests live in `tests/<subject>/*.test.ts`, grouped by subject
    (`tests/html/`, `tests/auth/`, `tests/env/`, `tests/edi/`), and reuse the `@` /
    `@shared` path aliases. A new test goes in the suite for its subject,
    or a new subject directory — **not** in a new script under
    `scripts/dev/`. Tests do not run as a completion gate; run them on
    demand and before merging. *Whether* a test should be written at all
    is settled by the non-negotiable rule "A regression test must earn
    its place" below.

-   **`scripts/dev/` holds developer checks only.** Operational tools and
    data audits a human runs deliberately live in `scripts/tools/`;
    one-time-use scripts live in `scripts/oneoffs/` (see below).

-   **`scripts/` is outside the app typecheck.** `npm run check` covers the
    app TypeScript entry points, not migration loaders and other scripts.
    Run `npx tsc -p tsconfig.scripts.json --noEmit` before first execution of
    a new or changed script.

## Stack

-   **Frontend**: React 18, TypeScript, Vite, Wouter, TanStack Query, React Hook Form, Shadcn/ui (Radix UI), Tailwind CSS ("new-york" theme)
-   **Backend**: Express.js, TypeScript
-   **ORM**: Drizzle ORM
-   **Validation**: Zod, libphonenumber-js
-   **Database**: PostgreSQL (Neon Database)
-   **Object Storage**: Replit Object Storage (Google Cloud Storage)
-   **Auth**: Multi-provider (Replit Auth, Okta, SAML/OAuth, Clerk, local)
-   **Logging**: Winston with PostgreSQL backend
-   **Real-time**: WebSockets
-   **Task Scheduling**: node-cron

## Where things live

-   **Database Schema**: `server/schema.ts` (implied by Drizzle ORM usage)
-   **API Routes**: `server/modules/` (feature-based modules)
-   **Frontend Pages**: `client/src/pages/` (lazy-loaded)
-   **UI Components**: `client/src/components/`
-   **Access Control Policies**: `server/modules/*/access.ts` (implied by entity-based policy architecture)
-   **UI Theme**: `tailwind.config.ts` (implied by Tailwind CSS with "new-york" theme)
-   **Plugin Framework**: shared base `server/plugins/_core/` (kind
    registration `kinds.ts`, config adapters `config-adapter.ts`),
    per-kind code `server/plugins/<area>/<kind>/`, config storage
    `server/storage/system/plugin-configs*.ts`, admin UI
    `client/src/pages/admin/plugin-configs*.tsx`. Adding a *kind* (as
    opposed to a plugin) is gated by the non-negotiable rule
    "A new plugin kind is a deliberate architectural decision" below.
-   **Wizards**: `server/wizards/types/`, `client/src/components/wizards/steps/`
-   **Wizard Plugin Framework (spike)**: `server/plugins/wizards/` (sixth plugin kind on `server/plugins/_core/`; fixed dispatcher routes so adding a wizard adds zero routes), pilot at `server/plugins/wizards/plugins/report-gbhet-legal-compliance.ts`; client generic renderers `client/src/components/wizards/framework/`, escape-hatch component registry `client/src/plugins/wizards/`
-   **Dispatch System**: `server/modules/dispatch/`, `client/src/pages/dispatch/`
-   **Ledger System**: `server/modules/ledger/`, `client/src/pages/ledger/`
-   **SFTP Client Destinations**: `server/modules/sftp-client-destination/`, `client/src/pages/config/sftp-client-destinations/`

## Stable layout CSS ids (public contract)

These ids exist so deployment-specific "client injection" CSS can target
layout regions reliably (e.g. `#site-banner { background: #3333cc; }`).
Treat them as a public contract — do not rename casually:

-   `#site-header` — whole `<header>` wrapper (banner + menu), in `Header.tsx`
-   `#site-banner` — top header row (site name / user menu bar)
-   `#site-menu` — desktop main navigation row
-   `#site-menu-mobile` — mobile navigation sheet content
-   `#site-title` — page title area (`PageHeader.tsx`, contains the h1)
-   `#site-content` — main body/content area (`<main>` in `App.tsx`)
-   `#site-footer` — footer (`Footer.tsx`)

## User preferences

Preferred communication style: Simple, everyday language.

**Never push to `bao-prd` or `bao-dev` automatically.** If you think
something needs to be pushed to either branch, stop and ask the user —
they will do the push themselves.

Diagnostic logging: do NOT redact or truncate diagnostic details in
admin-gated log entries (e.g. SAML failure logs). The admin log viewer is the
only debugging surface on external deployments — persist the full raw error
and request payload so problems can be diagnosed without server-log access.

Check the checked-out branch BEFORE editing any file. Application code is
written on `main` only. If the workspace is on `freeman-dev` (or any other
deployment branch) and the work touches anything outside `.github/` and
`deploy/`, stop and say so instead of committing to the wrong branch — code
landing on a deployment branch is what causes the recurring merge conflicts.

## Git remotes & branch policy

-   **`main` → `origin` (github.com/samknelson/sirius) only.** `main` must
    never contain `.github/` or `deploy/` — both are gitignored on main and
    were stripped from its history (the Replit Git token lacks the
    `workflow` scope, and the deploy env files must not reach origin).
-   **`freeman-dev` and `freeman-uat` → `freeman` remote only, never
    origin.** Each carries `.github/` (CI workflows) and `deploy/` on top of
    main, and nothing else of its own. To update either: merge `main` into
    it, then push it to the `freeman` remote.
-   **Merges only ever run `main` → `freeman-*`, never the reverse.** Both
    Freeman branches carry commits that add the CI files and commits that
    delete them. Merging either branch into `main` pulls that add/delete
    history into `main`'s ancestry, which can move the merge base for the
    *other* branch onto a commit where the CI files exist. When it does,
    that branch's next `git merge main` sees "present in base, absent in
    main" and takes the deletion — silently for untouched files, as a
    modify/delete conflict for edited ones. Whether it bites in any given
    case depends on the resulting graph, so treat it as a hazard to stay
    away from rather than a rule to reason around: the CI files have
    already been destroyed on `freeman-uat` twice. If real code is
    stranded on a Freeman branch, cherry-pick it onto `main` instead of
    merging the branch.
-   **Never point a task agent at a Freeman branch.** Application work is
    done on `main` only. A task agent branches from a tree that has no CI
    files, and the "commit prior to merge" snapshot it writes records them
    as deleted — which is exactly how `freeman-uat` lost them.
-   Edits to `.github/` or `deploy/` are committed on a Freeman branch only,
    using `git add -f` (the paths are gitignored). The on-disk copies in the
    main working tree are untracked-and-ignored — do not `git add` them.
-   **If the CI files vanish from a Freeman branch again**, restore them
    from a known-good source *for that environment* — the branch's own last
    good commit or a backup ref, and the other Freeman branch only while the
    two are known to be identical:

        git checkout <known-good-ref> -- .github deploy && git commit

    Then verify both the count and the contents. Count with
    `git ls-tree -r --name-only <branch> -- .github deploy` (8 files today);
    contents matter because once the branches carry environment-specific
    config, restoring from the wrong one silently overwrites it. `git status`
    shows nothing here once the files are ignored-and-untracked.
-   The `main-branch-files` architecture-lint rule enforces the first bullet:
    on `main` it fails when any `.github/` or `deploy/` file is tracked
    (`git ls-tree`, not `git status`) and tells you to run
    `git rm -r --cached .github deploy`. On a Freeman branch it fails when
    those directories have gone missing instead.
-   The `carrying-branch-drift` architecture-lint rule catches the opposite
    accident: a finished feature merged onto a Freeman branch because that
    was the branch checked out when the work completed, leaving it
    unreachable from `main`. It runs only on a Freeman branch and fails when
    that branch changed anything outside `.github/` and `deploy/` that still
    differs from `main`, naming the paths and the `git checkout <branch> --
    <paths>` repair. A branch merely *behind* `main` passes.
-   Helper script for the one-time history split: `.local/split-branches.sh`.
-   **`bao-dev` / `bao-prd` (deployment branches) are pushed only via the
    "Push to bao-dev" / "Push to bao-prd" workflows**
    (`scripts/dev/push-branch.sh`) — never a manual `git push`; verify the
    push in the workflow's logs. Workspace commits use
    `git -c core.hooksPath=/dev/null commit` (bypasses hook interference;
    the registered validations still run on task completion).

## Gotchas

-   **S1→S2 migration / loader-operations gotchas live in `docs/GOTCHAS.md`**
    (election bundle-name trap, cumulative rate display, end-of-run reject
    gates, ECS image pinning, …). Read it before running or debugging
    migration loaders.
-   **Facility Contact Sync**: Renaming a facility must go through `storage.facilities.updateContactName` to keep the facility and its associated contact in sync.
-   **Wizard Access Control**: While `/wizards/:id` only requires authentication, the API endpoints enforce granular authorization.
-   **T631 Facility Sync**: The `sitespecific-t631-facility-fetch` cron job is disabled by default and gated by the `sitespecific.t631.client` component. It only syncs `name` and `sirius_id` and does not delete local-only rows or write arbitrary `data` jsonb.
-   **Component-owned plugin-config subsidiaries**: `plugin_configs_dispatch` (dispatch) and `plugin_configs_benefit_eligibility` (trust.benefits) are owned by their components' `schemaManifest` and created by schema-push on enable — they are NOT core tables. `plugin_configs_event_notifier` and the charge / dashboard / cron / payment_gateway subsidiaries stay core.
-   **A component becoming schema-managing while already enabled**: the startup component-migration runner self-heals. If an enabled component gains a `schemaManifest`/migrations but has no `component_schema_state_<id>` variable yet (that variable is normally created by the enable flow), the runner initializes it via `enableComponentSchema` (idempotent for an already-present, drift-free table) instead of hard-failing boot. This is what lets already-enabled deployments pick up a newly component-owned table without a per-deployment baseline.

## Always restart the `Start application` workflow after server-side or shared changes

The dev server runs under `tsx` and **does not hot-reload** changes to
files outside the Vite client bundle. Vite HMR only refreshes the
browser-side code under `client/`. Anything the Node process holds in
memory (Express routes, middleware, registries, schemas, the access
policy/component caches) keeps the old version until the workflow is
explicitly restarted.

**Rule of thumb:** if your edit touches any of the following, restart
the `Start application` workflow as the **last step before telling the
user to verify**:

- `server/**` — routes, modules, services, storage, plugins, crons,
  middleware, app-init, etc.
- `shared/**` — tab registry, components registry, schema, access
  policies, terminology, anything imported by the server.
- New API endpoints, new tabs, new components, new policies, new
  storage namespaces, new cron jobs, new feature flags.
- Anything that mutates a server-held cache (component cache, access
  policy cache, modular policy registry, terminology cache).

Pure client-only changes under `client/src/**` (components, pages,
hooks, styles) do **not** require a workflow restart — Vite HMR
handles them.

When in doubt, restart. It is cheap, and it avoids the
"why-don't-I-see-the-new-tab" loop. After restarting, also remind the
user that a hard refresh may be needed if a TanStack Query cache
(default 5 min staleTime, e.g. `/api/access/tabs`) is holding the
previous result.

# Non-Negotiable Rules

## All schema changes MUST ship with a migration

There is exactly one way to change the database shape: write a migration
file under `scripts/migrate/` and register it from
`scripts/migrate/index.ts`. The startup drift gate (`server/services/
schema-drift-check.ts`) reflects the live database, compares it to the
expected Drizzle schema for the core plus every currently-enabled
schema-managing component, and refuses to boot the server if anything is
missing, extra, or mistyped.

**File layout:**

-   `scripts/migrate/core/<NNN>_<name>.ts` — global migrations (anything
    in `shared/schema.ts` that is not owned by a component manifest).
    Tracked by the `migrations_version` variable.
-   `scripts/migrate/components/<componentId>/<NNN>_<name>.ts` —
    per-component migrations. Tracked by the
    `component_schema_state_<componentId>.migrationVersion` field inside
    the existing component-state variable (no new bookkeeping table).
    The counter persists across disable/enable cycles, so re-enabling a
    component whose tables were retained does NOT replay migrations it
    has already applied.
    **A new component table needs three things, together:** the
    `pgTable` in the component's schema module, an entry in that
    component's `schemaManifest.tables` in `shared/components.ts` (in FK
    creation order, with the manifest version bumped), and a component
    migration that creates it on databases already brought up. The
    manifest is the only thing the enable-path push and the drift gate
    consult; a table declared in the schema module but left out of the
    manifest is never created on an existing deployment and — because it
    is still exported through `shared/schema.ts` — is judged a missing
    CORE table on every deployment without it. The
    `component-manifest-coverage` architecture-lint rule fails the build
    when any `pgTable` in a component's schema module is missing from its
    manifest (`npx tsx scripts/dev/lint.ts component-manifest-coverage`).
    **A core migration must never hard-depend on a component-owned
    table.** It runs on every deployment; a table in a component's
    `schemaManifest` only exists where that component is enabled, and
    most components default to off. An unguarded reference throws on
    every deployment where the component is disabled, and because the
    runner stops at the first failure the database is left
    half-migrated with every later migration pending behind it and the
    app refusing to serve. Probe for the table first (an
    `information_schema` lookup naming it, skipping with a log line
    when it is absent — see `1015_create_plugin_configs.ts`), or put
    the migration under the component instead. The
    `core-migration-component-tables` architecture-lint rule enforces
    this as part of the `lint` gate: it scans the SQL each core
    migration executes (so a table name in a comment, a log line or
    the description needs no guard) and demands a check that names
    that table and is branched on before its first use — a probe for
    some other table, or one placed after the fact, does not count.
    Run it alone with
    `npx tsx scripts/dev/lint.ts core-migration-component-tables`.

-   `scripts/migrate/baseline/<replit-name>-<YYYYMMDD>.ts` — one-off,
    per-deployment scripts that bring a database into sync at a known
    point in time. Baselines are registered as core migrations at version
    `>= 1000` and run exactly once like any other migration. They MUST be
    idempotent on re-run. See `docs/baselining.md` for the full
    procedure.

**Forbidden:**

-   `drizzle-kit push` (and `npm run db:push`) outside the dev-loop
    escape hatch — `scripts/db-push.ts` now refuses to run unless
    `ALLOW_DB_PUSH=1` is set. Never set it in production. Never invoke it
    from automation. Its only legitimate use is "I want to peek at the
    DDL drizzle-kit would generate so I can paste it into a migration I'm
    writing."
-   Reflective additive ALTERs from `component-schema-push.ts`. The
    `applyMissingColumns` path has been retired. `pushComponentSchema`
    now only creates missing tables on first enable; any drift against
    an existing table throws `ComponentSchemaDriftError` and the
    operator must author a migration.
-   Editing `shared/schema*` without adding a matching migration file.
    The author-time check at `scripts/check-migrations.ts` enforces this:

    ```
    npx tsx scripts/check-migrations.ts
    # or, against a base ref:
    npx tsx scripts/check-migrations.ts --base=origin/main
    ```

    The escape hatch for pure type/comment refactors is the
    `[skip-migration-check]` marker in the commit message or the
    `--skip` flag — use it sparingly and explain why in the PR.

    Whenever a `shared/schema*` file is touched, `check-migrations.ts`
    also runs `scripts/dev/check-constraint-names.ts`, which fails if
    any FK / unique / index / primary-key name drizzle would generate
    exceeds Postgres's 63-char identifier limit (over-length names
    churn forever under db-push). The fix is to pin an explicit name:
    convert inline `.references()` to an extraConfig
    `foreignKey({ name, columns, foreignColumns })` builder, or use
    `unique("name").on(...)`. The name-length check is NOT skipped by
    `[skip-migration-check]`, and can be run standalone via
    `npx tsx scripts/dev/lint.ts constraint-names`.

**Dev-only escape hatch for the startup gate:** setting
`SKIP_SCHEMA_DRIFT_CHECK=1` skips the check at boot. This exists so a
developer can get into the app to inspect a broken state. It is NEVER
acceptable in production or in any deployment configuration.

## One-time-use scripts MUST live in `scripts/oneoffs/`

Any one-off script — seeders, data backfills/fixups, populate/import
helpers, and ad-hoc smoke tests — must live under `scripts/oneoffs/`,
never at the top level of `scripts/`. The top level of `scripts/` is
reserved for the durable tooling that the app and its checks depend on
(`migrate/`, `db-push.ts`, `check-migrations.ts`, etc.).

The rest of `scripts/` is split by who runs it and when:

-   `scripts/dev/` — checks. The lint entry point (`lint.ts`) and the
    architecture-lint rules it registers — every file here is
    reachable from `npm run lint`. Nothing here is a behavioral test;
    those go in `tests/`. A new check is a rule in the `RULES` table of
    `lint.ts` or a case under `tests/` — never a new script here with
    its own workflow or registered validation.
-   `scripts/tools/` — repeatable operational tools and data audits a
    human runs deliberately, never automatically: the Freeman
    auto-approve poller, the structure-change git review tool, and the
    signed-document sanitize audit. Run via
    `npx tsx scripts/tools/<name>.ts`.
-   `scripts/oneoffs/` — one-time-use scripts, as above.

## A regression test must earn its place

**A test never ships as a follow-up task.** If a change is worth
protecting, the protection is written inside the task that changes the
behavior — same branch, same review. Do NOT propose "prevent a
regression in X", "confirm X still works", or "catch Y before it ships"
as a follow-up task, and do not accept one. Either the test belonged in
the original task, or it should not be written at all. This is the
default that must stop: a task ending with a proposed test task is a
defect in the task, not thoroughness.

**The bar.** Write the test only when **all six** hold:

1.  **It has broken, or a concrete change would break it.** A real past
    breakage, or a specific foreseeable change — not "someone might one
    day touch this."
2.  **The subsystem is finished.** Its design has settled and is not
    still being actively built out.
3.  **The breakage would be silent** — wrong-but-plausible output, a
    missing notification, a permission that quietly stops being
    enforced. If it would crash loudly or fail typecheck, the crash is
    the test.
4.  **Nothing already catches it** — not `typecheck`, not an existing
    architecture-lint rule.
5.  **It runs cheaply** — no live database record, no spawned server, no
    network.
6.  **It fits an existing subject suite**, or the subject is substantial
    enough to justify a new one.

**Do not write it** when any of these is true — these are
disqualifying, not debatable:

-   **The subsystem is still under active development.** Testing an
    unfinished design pins decisions nobody has made yet, and the tests
    fight the remaining work instead of protecting it. Wait until it
    settles.
-   It restates a guarantee the type system already provides.
-   It guards a hypothetical future refactor nobody has planned — the
    "in case someone adds a new channel someday" test.
-   It is one-time verification that a migration or conversion worked.
    Verify it once by hand, then throw the verification away; it has no
    ongoing value.
-   It needs a live DB row or a spawned server to assert anything, which
    usually means it is testing plumbing rather than a rule.
-   An existing suite already covers the same invariant from another
    angle.

**Lint rule or test?** Two mechanisms, and the choice is not taste:

-   **A repo-wide architecture-lint rule** when the risk is
    *structural* — "this kind of code must not appear in that kind of
    place" (a raw `sql` template outside `server/storage/`, a
    `process.env` read outside the registry). One rule covers the whole
    class permanently, where a test only covers the instance in front of
    you. It goes in the `RULES` table in `scripts/dev/lint.ts` and runs
    under the existing `lint` gate.
-   **A subject test suite** when the risk is *behavioral* — a specific
    invariant about what the code computes or decides. It goes in
    `tests/<subject>/*.test.ts` and runs under `npm test`.

    The finished-subsystem rule applies to lint rules too: a structural
    rule about a design still in flux constrains decisions that have not
    been made yet. Do not write one for a subsystem you are still
    building.

**Where it goes.** Adding a test means adding a case to the suite for
its subject, or a new `tests/<subject>/` directory when the subject is
substantial. Adding a rule means adding a row to the `RULES` table.
**The anti-pattern — do not do this — is a new top-level script under
`scripts/dev/` with its own workflow / registered validation.** The
automated gates are exactly the three listed in Run & Operate, and that
list does not grow one check at a time.

## Lockfile URLs MUST point at the public npm registry

Every `resolved` tarball URL in `package-lock.json` must point at
`https://registry.npmjs.org/`. Any `npm install` run **inside this Replit
workspace** goes through Replit's internal npm proxy and rewrites the
`resolved` URLs of the packages it touched to
`http://package-firewall.replit.local/npm/…`. That host only resolves inside
Replit, so GitHub Actions and the Docker build then die at `npm ci` with
`EAI_AGAIN package-firewall.replit.local`. Versions and integrity hashes are
untouched — only the URL host is wrong.

So after any install here, check the lockfile before committing:

    npx tsx scripts/dev/lint.ts lockfile-registry

and if it fails, rewrite the host (nothing else changes):

    sed -i 's#https\?://package-firewall\.replit\.local/npm/#https://registry.npmjs.org/#g' package-lock.json

The `lockfile-registry` architecture-lint rule enforces this as part of the
`lint` gate, naming every offending package. CI and the Dockerfile
deliberately do **not** rewrite URLs at build time — the lockfile in the repo
is expected to be correct.

## Environment variables (registry required)

All environment variables the app reads must be declared in the central
registry (`server/config/env-registry.ts`) with a description, secret flag,
and category (core, platform, or a component id), and read through
`getEnvironmentVariable()`. Direct `process.env` access is only allowed
inside the registry module. Component-owned modules register their own
variables at module load; dynamically-named lookups (FILESYSTEMS `*_secret`
settings, payment-gateway `secretName`, address-validation `apiKeyName`)
register at parse/resolve time as secrets. Client-side
`import.meta.env.VITE_*` reads are exempt (compile-time substitution).

The `env-registry` architecture-lint rule enforces this (it covers untracked
files), as part of the `lint` gate. To run just that rule:

    npx tsx scripts/dev/lint.ts env-registry

Registry + enforcement tests: `npm test -- tests/env`.

Because files in `scripts/oneoffs/` are one level deeper, their
relative imports use `../../` (e.g. `../../server/storage/database`,
`../../shared/schema`), and they run via
`npx tsx scripts/oneoffs/<name>.ts`. Match the import style of the
existing files already in that directory.

## All database access MUST go through the storage layer

This is a hard, project-wide rule with **no exceptions**. Every database
query — read or write, one row or one million — must be issued from a
method on a storage module under `server/storage/`. Anything else is a
bug.

**Forbidden anywhere outside `server/storage/`** (this includes every
file under `server/modules/`, `server/services/`, `server/routes/`,
cron handlers, dashboard plugins, eligibility/charge plugins, web
service handlers, scripts, seeders, and any other server-side code):

-   Importing `db` from `server/db.ts`.
-   Calling `getClient()` from `server/storage/transaction-context`.
-   Embedding `sql\`...\`` template literals.
-   Calling `db.execute(...)`, `db.select(...)`, `db.insert(...)`,
    `db.update(...)`, `db.delete(...)`, `db.transaction(...)`, or any
    direct Drizzle query builder method on a database client.
-   Importing schema tables from `@shared/schema` for the purpose of
    building a query (importing types is fine).

**Required pattern:** Add or extend a method on the appropriate
`*Storage` interface (e.g. `storage.workers.foo(...)`,
`storage.cardchecks.bar(...)`) and call it from your route/service.
Routes stay thin; all SQL lives in storage.

**Read-only escape hatch:** `storage.readOnly.query(async (client) =>
…)` exists for cross-cutting reports that don't fit a single domain.
It is acceptable **only inside a storage method**, never inside a
route handler, service, plugin, or cron job.

**Plugin opt-in for direct read-only DB access:** Plugins are the one
sanctioned exception. A plugin whose only database need is a single,
pure-read query it alone uses may run that query inline with
`storage.readOnly.query(...)` instead of adding a one-off storage
method — but it MUST opt in by declaring `needsReadOnlyDb: true` in its
metadata (`BasePluginMetadata` in `server/plugins/_core/types.ts`,
surfaced by the dashboard, trust-eligibility, charge, and
event-notifier registries). This keeps the escape hatch visible and
auditable. **Mutations always stay in storage** — the opt-in covers
reads only. The `storage-encapsulation` architecture-lint rule
(`npx tsx scripts/dev/lint.ts storage-encapsulation`) fails any file under
`server/plugins/` that calls `readOnly.query(...)` without declaring
`needsReadOnlyDb` (shared plugin-kind infrastructure such as
`server/plugins/trust/eligibility/executor.ts` is allowlisted there).

**Cross-domain query helpers:** When a feature needs to query several
unrelated tables (for example, contact-link resolution touches
`workers`, `employer_contacts`, and `trust_provider_contacts`), do
**not** put those queries in a service file. Add a dedicated storage
namespace (e.g. `storage.contactLinks`) that exposes one focused method
per query, and have the service compose the results in pure
TypeScript.

**Service files stay query-free:** Files under `server/modules/` and
`server/services/` may orchestrate, transform, and aggregate data
returned by `storage.*` calls, but they must not import schema tables,
`db`, `getClient`, or `drizzle-orm` operators (`eq`, `and`, `ilike`,
`sql`, `inArray`, etc.) for query construction. If you reach for any
of those imports, the work belongs in a storage method.

**Routes stay thin:** Route handlers should call one or more
`storage.*` methods, perform request validation, and shape the
response. They must contain zero query logic.

If you find yourself wanting to break this rule, the answer is always
to add a new storage method instead. See `docs/architecture-decisions.md`
(the **Database Access Architecture** entry under System Design Choices)
for the rationale (audit logging, access control, validation,
separation of concerns).

## Entity / page navigation MUST use the shared tab registry

Every entity detail page and any persistent page-level navigation in
the app must be driven by the shared tab registry (`shared/tabRegistry.ts`)
plus a dedicated entity Layout under `client/src/components/layouts/`.
The registry is the single source of truth for which tabs exist,
which access policy / component / capability gates them, and what
URLs they live at — and the matching backend evaluator
(`server/modules/access-policies.ts`) is what makes per-user tab
filtering work.

**Forbidden for entity / page navigation:** importing
`Tabs`, `TabsList`, `TabsTrigger`, or `TabsContent` from
`@/components/ui/tabs` to build the top-level navigation of an entity
detail page (Worker, Employer, Trust Provider, Trust Benefit, Trust
Election, Dispatch Job, Bulk Message, etc.) or any other persistent
page-level navigation. If you find yourself reaching for ad-hoc Radix
Tabs to switch between "views" of an entity, stop and add a tab to
the registry instead.

**Required pattern when adding or modifying an entity detail page:**

1. Add (or extend) a `TabEntityType` and `*TabTree` in
   `shared/tabRegistry.ts` and register it in `tabTreeRegistry`.
2. Wire the entity into the batch tab access endpoint in
   `server/modules/access-policies.ts` (`entityPolicyMap` plus any
   entity-specific ID resolution).
3. Add a thin `use<Entity>TabAccess` wrapper in
   `client/src/hooks/useTabAccess.ts`.
4. Add a `<Entity>Layout.tsx` under `client/src/components/layouts/`
   modeled on `TrustBenefitLayout.tsx` or `WorkerLayout.tsx` (the
   canonical examples to copy from). The layout owns the header, the
   back button, `usePageTitle`, and the registry-driven tab strip.
5. Wrap each page in `<EntityLayout activeTab="...">` and render only
   the body content.

**Narrow exception — intra-page widget tabs:** Radix `Tabs` from
`@/components/ui/tabs` are still allowed for clearly intra-page widget
tabs that are not entity / page navigation. The current legitimate
usages are:

- `client/src/pages/admin.tsx`
- `client/src/pages/config/users.tsx`
- `client/src/pages/wizard-view.tsx`
- `client/src/pages/flood-events*`
- `client/src/components/SignatureModal.tsx`
- `client/src/components/btu-dues-allocation/ResultsStep.tsx`

These are widget-level tab strips inside a single page (e.g. a modal
or a results panel) and are explicitly out of scope of the
prohibition. Adding new such usages should be rare and well-justified.

If your tab strip switches the route, gates by access policy /
component, or names a persistent "view" of an entity, it belongs in
the registry — not in `@/components/ui/tabs`.

## Config pages use a fixed-width layout

Every page under Config (anything rendered inside
`client/src/components/layouts/ConfigurationLayout.tsx`) is automatically
constrained to a centered, fixed max width — the layout wraps its
`children` in a `max-w-7xl mx-auto` container. **Do not** add a competing
full-width or differently-sized top-level wrapper to a config page; let
the layout own the width so every config page looks the same.

If a page needs the canonical inner padding to match older pages, use the
established wrapper `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8` (the
nested `max-w-7xl` is harmless inside the layout's container). New config
pages can simply render their content directly and rely on the layout for
width.

## A new plugin kind is a deliberate architectural decision

A **plugin kind** is a category of pluggable implementation registered
with `registerPluginKind()` (`server/plugins/_core/kinds.ts`) — e.g.
`charge`, `dashboard`, `cron`. It is not a general-purpose branching or
configuration mechanism, and it must never be the default place to hang
new behaviour just because the code needs somewhere to put a branch.

**The A + B + C test.** A plugin kind is justified only when **all
three** of these are true:

-   **A. Interchangeable implementations.** There are genuinely
    extensible, interchangeable implementations of the *same* function,
    all satisfying one domain interface (e.g. "evaluate eligibility for
    this worker", "post charges for this event").
-   **B. Multiple live instances.** More than one instance of an
    implementation can exist in a running system — the same
    implementation configured twice, for different scopes, employers,
    schedules, or job types.
-   **C. Independent persisted configuration.** Each instance needs its
    own independent configuration, persisted in `plugin_configs` (plus
    the kind's subsidiary table where it carries relational
    dimensions), and administered through the generic admin UI.

Charge plugins clear this bar: many charge implementations, several
configured instances each, every instance carrying its own scope /
employer / account row. A registry that names three hardcoded call
sites does not clear it — it fails A and B outright, and C is
meaningless without them.

**If you fail the test, it is not a plugin kind.** Fail any one of A, B,
or C and the answer is one of the ordinary tools:

-   Configuration a site operator sets once → the **environment
    variable registry** (`server/config/env-registry.ts`), or the
    existing `variables` / component settings, per the rules above.
-   One implementation with some conditional behaviour → an **ordinary
    module or function**. Export it, import it, call it.
-   A fixed, closed set of call sites that need to differ → a **plain
    lookup table or callback map owned by the code that uses it**, kept
    next to that code, with no kind string, no registry ceremony, and
    no place in the admin UI. (`server/plugins/template-surfaces/` is
    the worked example: it uses the shared registry helper for
    duplicate detection but deliberately registers **no** kind and
    **no** config adapter, because a surface has no persisted
    configuration and is never administered.)

**Explicitly, a plugin kind is NOT:**

-   a substitute for the environment-variable registry;
-   a place to park settings that have nowhere else to live;
-   a way to branch behaviour between a fixed set of call sites;
-   a way to get a nice admin screen for free.

**Sign-off is required.** Adding a kind is an architectural decision a
programmer makes deliberately and explicitly. Get sign-off from the
project owner *before* writing the code, and say which of A, B, and C
the new kind satisfies and how. Adding a *plugin* to an existing kind
needs no such approval — that is the common, cheap case.

**Current kinds.** Each is registered by a
`registerPluginKind({ kind, registry, ... })` call in that kind's
`server/plugins/<area>/<kind>/index.ts`, and all of them are served by
the shared `GET /api/plugins/:kind/manifest` endpoint
(`server/modules/system/plugins-manifest.ts`).

*Config-backed — these are the kinds that clear A + B + C, and they are
the bar a new kind has to reach.* Each also registers a
`registerPluginConfigAdapter()` (`server/plugins/_core/config-adapter.ts`),
so its per-instance configs live in `plugin_configs` via
`server/storage/system/plugin-configs.ts`, it appears in the
`GET /api/plugins/kinds` index, and it is administered at
`/admin/plugin-configs/:kind`:

    charge, dashboard, dispatch-eligibility, trust-eligibility,
    trust-provider-edi, payment-gateway, event-notifier, cron, denorm,
    data-retention, client-injection

*Manifest-only — grandfathered exceptions that do NOT clear C.* These
were registered as kinds before this rule existed. They have no config
adapter, so they never appear on the plugin-configs index, and whatever
operator state they have does not live in `plugin_configs`: worker-ban
behaviours are configured from the Worker Ban Types options page, menus
are selected in Site Configuration, and tokens, wizards, and
system-status checks carry no operator configuration at all:

    wizard, menu, worker-ban, token, system-status

They are precedent for nothing. Do not cite them to argue that a new
kind may skip C, and do not add a sixth. A case that looks like one of
these is a case for a plain module or lookup table.

**Files a new kind touches** (all of them, every time — if your change
doesn't need most of this list, that is a signal you don't need a
kind):

1.  `server/plugins/<area>/<kind>/types.ts` — the domain interface.
2.  `server/plugins/<area>/<kind>/registry.ts` — a `PluginRegistry`.
3.  `server/plugins/<area>/<kind>/index.ts` — the `registerPluginKind()`
    call plus side-effect imports of each plugin, wired into
    `server/app-init.ts`.
4.  `server/plugins/_core/types.ts` and
    `client/src/plugins/_core/manifest.ts` — the `PluginKind` unions
    (the client file also carries `PluginSearchParamsByKind`).
5.  Config-backed kinds only: the `registerPluginConfigAdapter()` call,
    a subsidiary table + storage namespace in
    `server/storage/system/plugin-configs*.ts` if the kind carries
    relational dimensions, and a migration for it (see the migration
    rule above).

The step-by-step procedure, once the decision has been made and signed
off, is in `server/plugins/_core/README.md` ("Introducing a brand-new
plugin kind").

# Where to read more

-   **Architecture decisions** (YMD date convention, charge plugin
    idempotency, VDB pension reconciliation, etc.) — `docs/architecture-decisions.md`
-   **S1→S2 migration** (mapping spec, transformations, open questions,
    prod query pack) — `docs/s1-migration/`; operating procedure —
    `scripts/s1-migration/RUNBOOK.md` (§1: every migration command needs
    `TZ=America/Los_Angeles` — the pinned S2 system zone — or it refuses to
    write; this workspace pins the dev app the same way through a
    workspace-level `TZ` environment variable — do not remove it; the
    bao-* web services get theirs from Flight Control, §12 step 0);
    operational traps — `docs/GOTCHAS.md`
-   **System architecture & external dependencies** (full stack
    breakdown, system design choices, third-party libraries) —
    `docs/architecture.md`
-   **Baselining a deployment** (procedure for a new Repl whose DB
    predates the per-component migration framework) — `docs/baselining.md`
-   **Aurora / plain-Postgres support** (automatic Neon-vs-pg driver
    selection, `DATABASE_DRIVER` override, `sslmode` handling, and the
    `ALLOW_EMPTY_DB_BOOTSTRAP=1` empty-database bootstrap) — `docs/aurora.md`
-   **Plugin Framework contract** (how to add a plugin, the shared URL
    surface, and the procedure for a brand-new kind) —
    `server/plugins/_core/README.md`. Whether a new kind is warranted at
    all is settled first by the non-negotiable rule "A new plugin kind
    is a deliberate architectural decision".

## External docs

-   **React**: [https://react.dev/](https://react.dev/)
-   **Tailwind CSS**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
-   **Zod**: [https://zod.dev/](https://zod.dev/)
-   **Drizzle ORM**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
-   **TanStack Query**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
-   **Express.js**: [https://expressjs.com/](https://expressjs.com/)
-   **PostgreSQL**: [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)
