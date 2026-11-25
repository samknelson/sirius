# Optional components

Each directory under `components/` is exactly **one** optional component. The
directory name is the component ID (for example `components/contract.chat.foray`
is component `contract.chat.foray`), and everything specific to that component
lives inside it. To retire a component, stop the application, delete its
directory, rebuild and restart. There is no grouping above a component.

Installation means the source is present at build time. It does **not** mean
the component is enabled. Each component keeps its ID, persisted flag,
dependencies and schema-migration counter.

## The `component.json` manifest

All paths are relative to the component directory and must name existing files
inside that directory. Unknown fields are an error.

| Field | Contract |
| --- | --- |
| `definition` | Required. Shared module exporting `component: ComponentDefinition` — exactly one, whose `id` equals the directory name |
| `shared` | Shared modules exported by the generated shared barrel |
| `server` | Side-effect server registration modules (for example vendor registrations) |
| `schema` | Drizzle schema modules; also exported in the aggregate schema |
| `migrations` | Modules registering migrations under the component's ID and versions |
| `coreMigrations` | Historical global migrations, kept with their original version and scope |
| `startup` | Optional `register`, `registerRoutes`, `start` functions (`ComponentStartup`) |
| `storage` | Module exporting `createStorage`; its returned namespaces extend host storage |
| `metadata` | Module exporting `metadataContexts` for record history |
| `contributions` | Shared tabs, menus, operation aliases and deployment branches (`ComponentContributions`) |
| `client` | Browser routes, config navigation and EDLS crew editor/detail UI (`ComponentBrowserContributions`) |
| `maintenanceGuards` | Vendor handler declarations audited by the maintenance-guards lint rule |

Mirror the host's `shared/`, `server/`, `client/`, and `scripts/` boundaries.
Schema modules belong under `shared/schema/`; migrations under
`scripts/migrate/components/<component-id>/`. A managed schema's
`schemaPath` names the file inside the component directory. New tables still
require authored migrations. Discovery does not execute migration code.

## Dependencies and imports

A component declares the components it needs in `dependsOnComponents` (or
`schemaManifest.dependsOnComponents`), exactly as core components do. These
may be core components or other directories under `components/`.

- If a declared dependency is neither core nor present under `components/`,
  discovery fails with an error naming both components. Delete dependents
  together with what they depend on, leaves first.
- A component may import only from itself, from core, or from a component it
  declares as a dependency. The `component-imports` lint rule enforces this.
  Code that several components use lives in the component they all depend on
 .
- Core never imports from an optional component; the generated modules are the
  only bridge. The one exception is a core-registered directory (below).

## Core-registered directories (transitional)

Components still defined in `shared/components.ts` can move the files they
wholly own (schema, plugins, storage, routes modules, policies, pages) into
`components/<component-id>/` before they become removable. Their manifest is:

```json
{ "coreRegistered": true, "schema": ["shared/schema/dispatch/dnc-schema.ts"] }
```

- No `definition` and no registration fields: core keeps registering the
  component and imports the moved files directly. Only `schema` is allowed,
  so the schema loader can find the module named by `schemaPath`.
- Discovery requires the ID to exist in core, and generates nothing else.
- Files keep their host-relative path inside the directory
  (`server/storage/dispatch/worker-dnc.ts` becomes
  `components/dispatch.dnc/server/storage/dispatch/worker-dnc.ts`).
- Core may import from these directories only. The `component-imports` rule
  rejects core imports into any other component directory, and checks the
  moved files' own imports against the core definition's dependencies.
- Shared files that several components touch stay in core.

Making one removable later means adding a definition, replacing the core
imports with registrations, and dropping `coreRegistered`.

## Discovery and registration

`npm run components:discover` (`scripts/optional-components.ts`) generates
literal imports in the host's generated modules (`shared/generated/`,
`server/generated/`, `client/src/generated/`,
`scripts/migrate/generated-components.ts`). Do not edit them by hand. `npm run
dev`, `npm run check`, `npm run build`, Vite, Vitest, lint, migration checks
and the schema CLI entrypoints regenerate them. If running `tsc` or
`tsx server/index.ts` directly, run discovery first.

Discovery fails clearly when a directory has no `component.json`, when its
definition module exports zero or several components (a `components` list is
rejected), when the definition's ID differs from the directory name, when an
ID duplicates a core component, or when a declared dependency is missing. An
absent or empty `components/` directory is valid. Add or remove directories
only while stopped, then discover, rebuild and restart. Hot installation and
removal are not supported.

Server registrations are imported before initialization. The `register`
startup hook runs before permissions and alter-hook closure. Routes register
at the normal host route-registration boundary; `start` runs after application
initialization with the process's service roles. Runtime code is bundled using
static imports, including schema loaders; it never scans the filesystem.

The production build is database-independent. Migrations and drift validation
remain startup operations; `npm run build` must not call the gated, developer-only
database-push escape hatch.

## Retained ownership and removal

Under the serialized schema bring-up lock, the application records each
installed optional component's definition and **exact** table names in the
`component_ownership` variable, keyed by component ID. Entries for absent
components are never removed. Existing `component_schema_state_<id>` records also provide exact
ownership evidence for deployments upgrading directly to a build that omits a
formerly installed component.

Removing source never changes stored switches, plugin configurations,
component migration history or application data. An absent component is always
unavailable even if its saved switch says enabled. The Components page shows
retained settings and the not-installed status; toggling or repairing an absent
component is refused. Its tables are excluded from active-schema comparison
but recognized as retained ownership. Unrecorded tables still fail the normal
drift check. Corrupt ownership fails explicitly.

Schema push refuses to operate while absent components own retained tables;
this deliberately favors safety over generating destructive DDL from an
incomplete schema. Direct `drizzle-kit push` is refused; use the guarded wrapper.
Authored migrations remain the normal upgrade mechanism.

Restoring a directory restores the same ID and schema loader. Enabled
components run only pending migrations and then validate against the installed
schema; disabled components validate when re-enabled. Completed migrations do
not replay.

## Integration contracts

Contributions are additive declarations, not alter hooks. Server startup and
registration own identity strategies, inbound authentication providers and
vendor contract augmentation (including `ComponentExternalServices` names for
maintenance refusals).

Authentication selection is persisted in ws_clients.data.authenticationProvider as
{provider, configId}, or null for an explicit client-secret selection. Missing or
disabled providers refuse authentication. Unclaimed legacy authentication selections (the namespaced AuthorizationConfigId
suffix) are refused rather than silently treated as client-secret authentication; installed
providers can recognize their legacy selection without changing it. Unrelated extension data is not an authentication selection. Administrators
can explicitly select the desired authentication method.

T631 synchronization requires an installed, enabled identity strategy and refuses
before any writes or deactivation otherwise. Reinstalling restores that strategy
without changing worker identifiers. Component documentation and operator tools
remain inside the owning component directory.
