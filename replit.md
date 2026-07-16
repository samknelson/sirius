# Sirius

Sirius is a full-stack web application designed for comprehensive worker management, streamlining administration, enhancing user experience, and delivering business value through efficient operations.

## Run & Operate

-   **Automated validations** (registered, run on every task completion —
    no manual invocation needed): `constraint-names`
    (`scripts/dev/check-constraint-names.ts`), `migrations`
    (`scripts/check-migrations.ts --base=origin/main`),
    `storage-encapsulation` (`scripts/dev/check-storage-encapsulation.ts`),
    and `typecheck` (`NODE_OPTIONS=--max-old-space-size=8192 npm run check`
    — tsc with the memory headroom it needs; incremental, so re-runs are
    fast).
    A violation blocks completion with the script's actionable error.
    `check-migrations` now also sees untracked files (`git ls-files
    --others`), so a freshly written migration counts before it is
    committed.

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
-   **Wizards**: `server/wizards/types/`, `client/src/components/wizards/steps/`
-   **Wizard Plugin Framework (spike)**: `server/plugins/wizards/` (sixth plugin kind on `server/plugins/_core/`; fixed dispatcher routes so adding a wizard adds zero routes), pilot at `server/plugins/wizards/plugins/report-gbhet-legal-compliance.ts`; client generic renderers `client/src/components/wizards/framework/`, escape-hatch component registry `client/src/plugins/wizards/`
-   **Dispatch System**: `server/modules/dispatch/`, `client/src/pages/dispatch/`
-   **Ledger System**: `server/modules/ledger/`, `client/src/pages/ledger/`
-   **SFTP Client Destinations**: `server/modules/sftp-client-destination/`, `client/src/pages/config/sftp-client-destinations/`

## User preferences

Preferred communication style: Simple, everyday language.

## Git remotes & branch policy

-   **`main` → `origin` (github.com/samknelson/sirius) only.** `main` must
    never contain `.github/` or `deploy/` — both are gitignored on main and
    were stripped from its history (the Replit Git token lacks the
    `workflow` scope, and the deploy env files must not reach origin).
-   **`freeman-dev` → `freeman` remote only, never origin.** This branch
    carries `.github/` (CI workflows) and `deploy/` on top of main. To
    update freeman: merge `main` into `freeman-dev`, push `freeman-dev` to
    the `freeman` remote.
-   Edits to `.github/` or `deploy/` are committed on `freeman-dev` only,
    using `git add -f` (the paths are gitignored). The on-disk copies in the
    main working tree are untracked-and-ignored — do not `git add` them.
-   Helper script for the one-time history split: `.local/split-branches.sh`.

## Gotchas

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
    `npx tsx scripts/dev/check-constraint-names.ts`.

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
reads only. The author-time guard
`scripts/dev/check-storage-encapsulation.ts` fails any file under
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

# Where to read more

-   **Architecture decisions** (YMD date convention, charge plugin
    idempotency, VDB pension reconciliation, etc.) — `docs/architecture-decisions.md`
-   **System architecture & external dependencies** (full stack
    breakdown, system design choices, third-party libraries) —
    `docs/architecture.md`
-   **Baselining a deployment** (procedure for a new Repl whose DB
    predates the per-component migration framework) — `docs/baselining.md`
-   **Aurora / plain-Postgres support** (automatic Neon-vs-pg driver
    selection, `DATABASE_DRIVER` override, `sslmode` handling, and the
    `ALLOW_EMPTY_DB_BOOTSTRAP=1` empty-database bootstrap) — `docs/aurora.md`
-   **Plugin Framework contract** — `server/plugins/_core/README.md`

## External docs

-   **React**: [https://react.dev/](https://react.dev/)
-   **Tailwind CSS**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
-   **Zod**: [https://zod.dev/](https://zod.dev/)
-   **Drizzle ORM**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
-   **TanStack Query**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
-   **Express.js**: [https://expressjs.com/](https://expressjs.com/)
-   **PostgreSQL**: [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)
