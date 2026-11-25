# Optional components

Each directory under `components/` is exactly **one** optional component. The
directory name is the component ID (for example `components/contract.chat.foray`
is component `contract.chat.foray`), and everything specific to that component
lives inside it. To retire a component, stop the application, delete its
directory, rebuild and restart. There is no grouping above a component.

Installation means the source is present at build time. It does **not** mean
the component is enabled. Each component keeps its ID, persisted flag,
dependencies and schema-migration counter.

## Scoped dispatch extensions

Dispatch children own their routes, tabs, settings, options fields, events,
plugins and UI contributions. Removing their source removes those offers;
it never deletes retained tables, saved component flags or extension data.

The browser contribution's `dispatchUi` supports job form fields/settings,
job-type settings, job summary/detail sections, worker dispatch panels and
job-list columns. List columns supply one provider for the visible job IDs,
so enriching a table or accepted-dispatch cards does not introduce a query
per row. Optional navigation entries can name a `before` path to retain their
position among core entries.

Form contributions register validation, data preparation and optional
post-save work with the host form. Preparation happens before the existing
save request; post-save work is awaited by the existing mutation. An
unmounted contribution does not transform the record, so editing unrelated
fields while a component is disabled or absent preserves its saved values.
UI mounting and visibility are not access grants: component-owned server
routes retain their original permissions and record policies.
ASI and DNC import their modular policies from their own server startups.
Shared exports and declarative policy descriptions alone do not initialize
the modular evaluator's runtime registry.

Component-owned options contributions add fields to the existing options
metadata and validators to the shared write rules used by normal edits and
imports. Field names and contribution IDs must be unique. A field's existing
component gate still controls its availability.

An eligibility plugin may prepare narrowly typed job-scoped context.
Preparation runs only for selected, enabled plugins, including listing
exclusions, and is shared by listing, explanation and acceptance. Use the
caller's ambient transaction; do not open an unrelated connection. Returned
keys cannot replace core context or another plugin's prepared values.

Component events retain their original wire names through typed event
registration. Foreperson token producers and stored-template rewrites also
register from the component, rather than leaving component-specific branches
in generic token evaluation.

## The `component.json` manifest

Module and script paths are relative to the component directory and must name existing files
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
| `metadata` | Module exporting `metadataContexts` for record history (a context may carry a `recordGo` access requirement) and optionally `excludedTables` — tables refused record history; holds while the component is disabled |
| `contributions` | Shared tabs, menus, operation aliases and deployment branches (`ComponentContributions`) |
| `client` | Browser routes, config navigation, lifecycle observers, page `slots`, EDLS crew UI and scoped dispatch UI contributions (`ComponentBrowserContributions`) |
| `earlyDocument` | Self-contained classic JavaScript files inlined first in the document head, before resources |
| `initializers` | Browser modules exporting `initialize()`, called before React mounts |
| `documentPolicies` | Exact public document paths with `referrerPolicy: "no-referrer"` and `cacheControl: "private, no-store"`, enforced in development and static-only production services |
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

Component events augment `ComponentEventPayloadMap` and declare their persisted
string with `registerComponentEvent`. Core consumers use the typed `EventName`
union and `getEventTypes()` rather than adding optional events to the core enum.
Variable declarations use `registerVariableEntry` during `startup.register`;
duplicate/reserved names are refused and the normal access/schema boundary
remains authoritative.

Shared tab contributions may name a `parent` tab and a `before` sibling. A
component may also contribute the first tabs of an entity type no core tree
covers: it adds the type to `TabEntityTypes` by interface augmentation and
registers a `tabs.entity-policy` alter answering that type's base access policy
(the batch check otherwise falls back to `authenticated`). The
`tabs.visibility` alter runs only after authorization, and can hide irrelevant
tabs. Its result is returned separately from `granted`; direct-route permission
checks do not become visibility checks.

Menu contributions name a `parent` menu node, or omit it for a top-level entry;
`before` orders among siblings.

A parent page never imports its dependents. It renders
`<ComponentSlot name="…" props={…} />` and a dependent contributes a lazy
`section` for that slot name in its browser `slots`; a section renders only
while its `component` is enabled. Grievance pages expose
`grievance.edit.sections` and `grievance.view.sections`.

A component may declare a whole options list with `registerOptionsContribution`
and a `definition`, adding its type name to `OptionsTypeNames` by interface
augmentation; `deleteGuard` refuses deleting a row referenced without a foreign
key. Notes/files areas register in `startup.register` naming their table (so the
orphan sweeps and retained-data checks know it while the component is disabled)
and subscribe their own delete cleanup with `cleanUpNotesForDeletedRecord` /
`cleanUpFilesForDeletedRecord` on the component's delete event.

Routes default to the authenticated layout. A component using `layout: "bare"`
owns its complete wrapper, including authentication, authorization and any
conditional chrome. Keep guards/layout imports behind a lazy route boundary
because navigation imports browser contributions during initialization.

Security-sensitive URL cleanup is not a lifecycle observer: `earlyDocument`
captures and sanitizes synchronously, and `initializers` consumes credentials
before React. First-in-head JavaScript alone does **not** prevent the speculative
preloader from using the original document URL as a referrer. Such documents
must also declare `documentPolicies`; those serialize into a dependency-free
server module so static-only services set headers before HTML parsing begins.
Do not put credentials in generated declarations.

Browser contributions may declare headless `lifecycle` observers, mounted inside
the host authentication provider even while their route is closed. Keep feature
cleanup in those component-owned observers, not in the host. The generic
`auth:session-ended` browser event is emitted before a logout redirect; observers
must distinguish initial authentication loading from an actual identity change.
For example, Contract Chat uses this boundary to discard temporary browser
history without adding transcript data to server sessions.

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

Grievance (`grievance`, `grievance.settlement`, `grievance.contract`) and
translation (`internationalization`, `internationalization.weglot`) are
removable: remove children before parents (settlement/contract before grievance,
Weglot before internationalization). Settlement and contract never import each
other.
