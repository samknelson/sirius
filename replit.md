# Sirius

Sirius is a full-stack web application designed for comprehensive worker management, streamlining administration, enhancing user experience, and delivering business value through efficient operations.

## Run & Operate

_Populate as you build_

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
-   **Dispatch System**: `server/modules/dispatch/`, `client/src/pages/dispatch/`
-   **Ledger System**: `server/modules/ledger/`, `client/src/pages/ledger/`
-   **SFTP Client Destinations**: `server/modules/sftp-client-destination/`, `client/src/pages/config/sftp-client-destinations/`

## Architecture decisions

-   **Centralized Database Access**: All DB interactions are routed through a single storage layer for audit logging, access control, and validation.
-   **Feature-based Module Structure**: Both frontend and backend are organized by feature modules for better maintainability and scalability.
-   **Metadata-driven Configuration**: Configurable settings use a unified, metadata-driven system to dynamically render forms and tables.
-   **Entity-based Access Control**: A modular, entity-based policy architecture with server-side LRU caching ensures fine-grained access control.
-   **Charge Plugin Idempotency**: Charge plugin executions are idempotent via `chargePluginKey` upsert, preventing duplicate ledger entries.
-   **YMD Date Convention**: Date-only fields (those representing a calendar day with no time component, e.g. `ledger.statement_ymd`) use Postgres `date` columns in `shared/schema.ts` and a `Ymd` string type (`"YYYY-MM-DD"`) in TypeScript. NEVER pass a `Ymd` through `new Date(ymd)` — that introduces UTC drift. Always go through helpers in `shared/utils/date.ts`: `dateToYmd`, `ymdToDateForPicker`, `formatYmd`, `isValidYmd`, `assertYmd`. In SQL, use `to_char(col, 'YYYY-MM')` (not `substring`) to bucket dates by month.
-   **VDB Pension Reconciliation via Cron (not cascade)**: SLA contribution-percent and share-based variable contribution ledger entries are produced by two cron jobs (`gbhet-pension-sla-reconcile`, `gbhet-pension-shares-reconcile`) calling `reconcileContributionPctYears` / `reconcileVariableContributionForAllWorkers` in `server/services/gbhet-pension-sla.ts`. Each batch tracks the `chargePluginKey`s it produces and uses `storage.ledger.entries.deleteOrphansByChargePluginAndKnownKeys` for self-healing orphan cleanup. The previous ledger-entry-saved event-driven cascade plugins and event plumbing have been fully removed.

## Product

-   **Worker Management**: Comprehensive CRUD operations for workers, contacts, and benefits, with search, filtering, and pagination.
-   **Organizational Settings**: Configurable settings for dynamic UI rendering.
-   **Legal Compliance Reporting**: Supports legal compliance through features like employment status mapping in wizards.
-   **Benefit Charge Billing**: Manages financial transactions, including accounts and payments, with entity-specific access.
-   **Dispatch System**: Manages dispatch jobs, types, listings, and detail pages, with a plugin system for worker eligibility.
-   **Multi-Provider Authentication**: Supports various authentication methods including Replit Auth, Okta, and SAML/OAuth.
-   **Wizards**: Flexible workflow state management for multi-step processes and report generation (e.g., Employer Onboarding, GBHET Legal).
-   **Bulk Messaging**: Infrastructure for managing and sending bulk messages across multiple mediums (email, SMS, postal, in-app).

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

-   **Facility Contact Sync**: Renaming a facility must go through `storage.facilities.updateContactName` to keep the facility and its associated contact in sync.
-   **Wizard Access Control**: While `/wizards/:id` only requires authentication, the API endpoints enforce granular authorization.
-   **T631 Facility Sync**: The `sitespecific-t631-facility-fetch` cron job is disabled by default and gated by the `sitespecific.t631.client` component. It only syncs `name` and `sirius_id` and does not delete local-only rows or write arbitrary `data` jsonb.

## Pointers

-   **React Documentation**: [https://react.dev/](https://react.dev/)
-   **Tailwind CSS Documentation**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
-   **Zod Documentation**: [https://zod.dev/](https://zod.dev/)
-   **Drizzle ORM Documentation**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
-   **TanStack Query Documentation**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
-   **Express.js Documentation**: [https://expressjs.com/](https://expressjs.com/)
-   **PostgreSQL Documentation**: [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)

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
    idempotent on re-run.

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

**Dev-only escape hatch for the startup gate:** setting
`SKIP_SCHEMA_DRIFT_CHECK=1` skips the check at boot. This exists so a
developer can get into the app to inspect a broken state. It is NEVER
acceptable in production or in any deployment configuration.

## Baselining a deployment

When a new deployment (a fresh Repl, a clone, a production cutover) has
a database whose shape predates the per-component migration framework,
its tables almost certainly do not exactly match `shared/schema*` and
the startup drift gate will refuse to boot. The fix is to write a
one-off baseline script that brings that specific database into sync.

**Procedure** (give the prompt below to an agent on the affected Repl):

> Build mode. Baseline this Repl's database for the per-component
> migration framework.
>
> 1. Read `replit.md` → "Baselining a deployment".
> 2. Start the server once with `SKIP_SCHEMA_DRIFT_CHECK=1` set so it
>    boots. Then unset it and start again; copy the full drift report
>    that `StartupSchemaDriftError` prints to the workflow logs.
> 3. For every item in the report:
>    - Missing column → ALTER TABLE ADD COLUMN with the right type and
>      a safe default for any non-empty table.
>    - Type mismatch → ALTER TABLE ALTER COLUMN ... TYPE ... with an
>      explicit USING clause if a cast is needed.
>    - Missing index → CREATE INDEX IF NOT EXISTS.
>    - Missing constraint → ALTER TABLE ADD CONSTRAINT IF NOT EXISTS.
>    - Missing table → CREATE TABLE — but check first whether the
>      component should actually be enabled; an unexpected missing
>      table usually means a component was enabled by default but
>      never went through the enable flow.
> 4. Create `scripts/migrate/baseline/<this-replit-name>-<YYYYMMDD>.ts`
>    that performs every fix-up above using guards
>    (`IF NOT EXISTS` / column existence checks) so re-running is a
>    no-op. Register it via `registerMigration` with a version `>= 1000`
>    and import it from `scripts/migrate/index.ts`.
> 5. For every `component_schema_state_<id>` variable that lacks
>    `migrationVersion`, stamp it to `0` so the per-component runner
>    has a defined starting point. (See
>    `scripts/migrate/baseline/sirius-dev-20260518.ts` for an example.)
> 6. Restart the workflow without `SKIP_SCHEMA_DRIFT_CHECK`. Verify
>    "Schema drift check passed" appears in the logs.
> 7. Commit the baseline file. Done.

The baseline for THIS Repl is
`scripts/migrate/baseline/sirius-dev-20260518.ts` — there were no DDL
fix-ups to apply (the dev DB was already in sync via the retired
reflective auto-push), so the baseline is a pure
`migrationVersion`-stamping script.

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
to add a new storage method instead. See the **Database Access
Architecture** entry under System Design Choices for the rationale
(audit logging, access control, validation, separation of concerns).

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

# System Architecture

## UI/UX Decisions
The frontend is built with React 18, TypeScript, Vite, Shadcn/ui (based on Radix UI), and Tailwind CSS with a "new-york" theme, ensuring a modern, accessible, and responsive user interface.

## Technical Implementations
-   **Frontend**: React 18, TypeScript, Vite, Wouter for routing, TanStack Query for server state management, and React Hook Form with Zod for form validation. Pages are lazy-loaded for performance.
-   **Backend**: Express.js with TypeScript, providing a RESTful API structured with feature-based modules.
-   **Authentication**: Supports multi-provider authentication (Replit Auth, Okta, SAML/OAuth, Clerk, local username/password) with environment-driven configuration and masquerade capabilities.
-   **Access Control**: Implements a modular, entity-based policy architecture with server-side LRU caching.
-   **Logging**: Winston logging is integrated with a PostgreSQL backend to maintain audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) is managed using Drizzle ORM.
-   **Object Storage**: Utilizes Replit Object Storage, backed by Google Cloud Storage.
-   **Real-time Notifications**: Features a WebSocket-based push notification system.
-   **Event Bus System**: A typed publish/subscribe event bus facilitates inter-service communication.
-   **Cron Job System**: Provides a framework for scheduling periodic tasks.
-   **Migration Framework**: Manages database schema changes with a versioned migration system.

## System Design Choices
-   **Database Access Architecture**: All database interactions are centralized through a storage layer for audit logging, access control, validation, and separation of concerns. **This is enforced as a hard rule — see the "All database access MUST go through the storage layer" section under Non-Negotiable Rules above.**
-   **Data Validation**: Utilizes Zod schemas and `libphonenumber-js` for robust data validation.
-   **Worker Management**: Comprehensive CRUD operations for workers, contacts, and benefits, with server-side pagination, search, and advanced filtering.
-   **Configurable Settings**: A unified, metadata-driven options system supports dynamic form and table rendering.
-   **User Provisioning**: Email-based provisioning integrated with Replit accounts and automatic contact synchronization.
-   **Employer & Policy Management**: Manages employer records, contacts, and historical policy assignments.
-   **Bookmarks**: Provides user-specific, entity-agnostic bookmarking functionality.
-   **Dashboard Plugin System**: An extensible architecture allows for customizable widgets. The server-side plugin manifest under `server/plugins/dashboard/plugins/*.ts` declares the client component as a string id (`<plugin-id>:<ComponentName>`) on an optional `client` block; the client auto-discovers components via `import.meta.glob('./*/*.tsx', { eager: true })` in `client/src/plugins/dashboard/registry.ts`. The dashboard and config pages consume `GET /api/dashboard-plugins/manifest` (no client-side static registry to maintain). Mirrors the Task #195 wizard framework conventions. **Every widget reads through a single front-door** — `client/src/plugins/dashboard/useDashboardContent.ts` calls `GET /api/dashboard-plugins/:pluginId/content[/:action]` and treats 403/404 as `undefined`. Widgets must NOT receive `userPermissions`/`enabledComponents` or re-check gating on the client; `DashboardPluginProps` is intentionally narrowed to `{ userId, userRoles, componentProps }`. Server-side component (`plugin.componentId`) and access-policy (`plugin.requiredPolicy`) gating in `dashboardPluginRegistry.runContent` are the authoritative enforcement points. When a widget needs cross-domain data, add it to that plugin's `content` resolver (default or map of actions) rather than introducing ad-hoc routes. Endpoint audit (Task #203): `/api/sessions`, `/api/bookmarks/enriched`, `/api/wmb-scan/status`, `/api/wizard-types`, `/api/wizards` are intentionally retained because non-dashboard pages still consume them (admin/wmb-scan-queue, bookmarks page, sessions page, wizard list pages). The dashboard widget reads of those endpoints have all been migrated to `/content`, so no widget-only ad-hoc read endpoints remain.
-   **Components Feature Flag System**: A centralized system for managing application features, including dependencies and access control.
-   **Ledger System**: Manages financial transactions, accounts, payments, and integrity reports, including payment batches.
-   **Wizards**: Offers flexible workflow state management for multi-step processes.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history.
-   **Trust Eligibility Plugin System**: A registry-based architecture determines worker eligibility.
-   **Events Management**: Full CRUD for events, occurrences, and scheduling.
-   **Dispatch System**: Manages dispatch jobs, types, listings, and detail pages, including a plugin system for worker eligibility filtering. Supports Dispatch Job Groups for grouping jobs with date ranges and external system linkage.
-   **Worker Bans**: Tracks worker restrictions and dynamically calculates active status.
-   **Worker Member Status History**: Tracks worker member statuses per industry over time.
-   **Worker Certifications**: Manages worker certifications with automatic skill synchronization.
-   **EDLS (Employer Day Labor Scheduler)**: Manages day labor scheduling with sheets, crews, department-based task assignment, supervisor tracking, and audit logging. Includes a TOS view at `/edls/tos` that lists every worker on active Time Off Sick alongside their upcoming day-labor assignments, with filters for supervisor, facility, and job group.
-   **Web Services Framework**: A server-side API framework for exposing services to external clients with client credential authentication and optional IP allowlisting.
-   **SFTP Client Destinations**: Manages SFTP client configurations with CRUD API and UI, including connection diagnostics.
-   **Trust Provider EDI**: Manages trust provider data interchange records with SFTP client destination integration.
-   **Bulk Messaging**: Infrastructure for bulk message management with multi-medium support (email, SMS, postal, in-app).

# External Dependencies

## Database Services
-   **Neon Database**: Serverless PostgreSQL hosting.

## UI and Styling
-   **Radix UI**: Accessible UI primitives.
-   **Tailwind CSS**: Utility-first CSS framework.
-   **Lucide React**: Icon library.

## Validation and Type Safety
-   **Zod**: Runtime type validation.
-   **TypeScript**: Static type checking.
-   **Drizzle Zod**: Integration between Drizzle ORM and Zod.
-   **libphonenumber-js**: Phone number parsing, validation, and formatting.

## File Transfer
-   **ssh2-sftp-client**: SFTP client library.
-   **basic-ftp**: FTP client library.

## Third-Party Integrations
-   **Twilio**: Phone number lookup, validation, and SMS messaging.

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.

## Task Scheduling
-   **node-cron**: Task scheduling and cron job execution.

## Security
-   **DOMPurify**: HTML sanitization.
