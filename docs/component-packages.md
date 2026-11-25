# Optional component packages

An optional package is a directory under `components/` with a
`component-package.json` manifest. Installation means its source is present at
build time. It does **not** mean its components are enabled. Each component
keeps its own existing ID, persisted flag, dependencies and schema-migration
counter.

## Manifest contributions

All paths are relative to the package directory and must name existing files
inside that directory.

| Field | Contract |
| --- | --- |
| `id` | Unique stable package ID |
| `definitions` | Shared module exporting `components: ComponentDefinition[]` |
| `shared` | Shared modules exported by the generated shared contribution barrel |
| `server` | Side-effect server registration modules (for example vendor registrations) |
| `browser` | Stable page key → module with a default React component export |
| `schema` | Drizzle schema modules; also exported in the aggregate schema |
| `migrations` | Modules registering migrations under their existing component IDs and versions |
| `startup` | Optional `register`, `registerRoutes`, `start` functions |
| `storage` | Module exporting `createStorage`; its returned namespaces extend host storage |
| `metadata` | Module exporting `metadataContexts` for record history |

Mirror the host's `shared/`, `server/`, `client/`, and `scripts/` boundaries.
Schema modules belong under `shared/schema/`; migrations under
`scripts/migrate/components/<component-id>/`. New tables still require authored
migrations. Package discovery does not execute migration code.

## Discovery and registration

`npm run packages:discover` generates literal imports in the host's generated
contribution modules. Generated sources are checked in to support editor
navigation; do not edit them manually. `npm run dev`, `npm run check`,
`npm run build`, Vite, Vitest, lint, migration checks, and the schema CLI
entrypoints regenerate them. If running `tsc` or `tsx server/index.ts` directly
instead of the supported npm commands, run discovery first.

An absent or empty `components/` directory is valid. A malformed manifest,
missing contribution or duplicate package ID is an error, not an empty package.
Add/remove source packages only while stopped, then discover, rebuild and
restart. Hot installation/removal is not supported.

Server registrations are imported before initialization. The `register`
startup hook runs before permissions and alter-hook closure. Routes register
at the normal host route-registration boundary; `start` runs after application
initialization with the process's service roles. Runtime code is bundled using
static imports, including package schema loaders; it does not import TypeScript
source paths from the production filesystem.

The production build is database-independent. Migrations and drift validation
remain startup operations; `npm run build` must not call the gated, developer-only
database-push escape hatch.

## Retained ownership and removal

Under the existing serialized schema bring-up lock, the application records
installed package component definitions and **exact** table names in the
`component_package_ownership` variable. Entries for absent components are
never removed. Existing `component_schema_state_<id>` records also provide
exact ownership evidence for deployments upgrading directly to a build that
omits a formerly installed component.

Removing source never changes stored switches, plugin configurations,
component migration history or application data. An absent component is always
unavailable even if its saved switch says enabled. The Components page shows
retained settings and the missing-package status; toggling/repairing an absent
component is refused. Its tables are excluded from active-schema comparison
but recognized as retained ownership. Unrecorded tables still fail the normal
drift check. Corrupt ownership fails explicitly.

Schema push refuses to operate while absent components own retained tables;
this deliberately favors safety over generating destructive DDL from an
incomplete schema. Direct `drizzle-kit push` is refused; use the guarded wrapper.
Authored migrations remain the normal upgrade mechanism.

Reinstallation restores the same IDs and schema loaders. Enabled components
run only pending migrations and then validate against the installed schema;
disabled components validate when re-enabled. Completed migrations do not
replay.

## Integration contributions

Packages may declare shared tabs, menus, operation aliases and deployment branches in a
contributions module. A client module declares routes, config navigation and EDLS crew
editor/detail components. These additive contributions are not alter hooks. Server
startup and registration contributions own identity strategies, inbound authentication
providers and vendor contract augmentation. Maintenance guard declarations live in
the package manifest. Historical global migrations may be contributed through
coreMigrations without changing their version or scope. Removal never deletes retained data.

Authentication selection is persisted in ws_clients.data.authenticationProvider as
{provider, configId}, or null for an explicit client-secret selection. Missing or
disabled providers refuse authentication. Unclaimed legacy authentication selections (the namespaced AuthorizationConfigId
suffix) are refused rather than silently treated as client-secret authentication; installed
providers can recognize their legacy selection without changing it. Unrelated extension data is not an authentication selection. Administrators
can explicitly select the desired authentication method.

T631 synchronization requires an installed, enabled identity strategy and refuses
before any writes or deactivation otherwise. Reinstalling restores that strategy
without changing worker identifiers. Package-owned documentation and operator tools
remain inside the owning package.
