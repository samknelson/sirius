# Component dependencies

Every component — defined in core (`shared/components.ts`) or in its own
`components/<id>/` directory — declares the components it depends on in ONE
place: the top-level `dependsOnComponents` of its definition. There is no
second list; `schemaManifest.dependsOnComponents` no longer exists and discovery
refuses it.

That one list is read by:

| Reader | Rule |
| --- | --- |
| Discovery (`scripts/optional-components.ts`, runs before dev, check, build, lint, migrations) | A core component may depend only on core components. An optional component may depend on core or on another **present** optional component. Unknown IDs, self-dependencies and cycles are errors. Removing a directory while a dependent remains fails with `Component "X" depends on component "Y", but components/Y is not present. Restore it, or remove "X" too.` |
| Enable flow (`PUT /api/components/config/:id`, `enableComponentSchema`, `repairComponentSchema`) | Refuses (409) unless every listed component is enabled and its declared tables exist. Applies to every component, schema-managing or not. |
| Boot migration runner | Runs per-component migrations dependencies first. |
| `component-imports` lint rule | Reports undeclared hard dependencies: imports, foreign keys, and raw SQL naming another component's declared tables. |

Dependencies are component IDs only — never a capability or provider name.
No component pair has bespoke pairing code: EDI → SFTP is an ordinary
declaration.

## The dotted-ID hierarchy is not a dependency

`dispatch.asi` sits under `dispatch` by name only. The dotted prefix (and the
`category` field) groups components for display; it implies **no** dependency,
is not checked at build or enable time, and nothing at runtime derives
behaviour from it (`getParentComponentId` / `getAncestorComponentIds` /
`getDescendantComponentIds` have no runtime callers). Several dotted parents
are not even components (for example `trust.benefits.eligibility` or `worker`).

When a child really needs its parent, it declares the parent in
`dependsOnComponents` like any other dependency (for example `dispatch.fore`,
`grievance.settlement`, `internationalization.weglot`). A child whose
features merely run inside the parent's flows (an eligibility plugin, a tab on
a parent page, a route guarded by `requireComponent(parent)`) is a soft link.

## Classifications

- **hard** — declared; blocks build (presence) and enable.
- **soft** — gated at runtime (`requireComponent`, `isComponentEnabled*`,
  plugin `requiredComponent`, existence-guarded SQL, contribution slots) and
  safe when the other component is absent or off.
- **to fix** — neither declared nor gated; requires an owner decision before
  changing component availability.

`npx tsx scripts/dev/check-component-imports.ts --audit` prints the
table-level inventory below (foreign keys, raw SQL, Drizzle table imports) from
current source.

## Audit (2026-11-26)

### Hard — declared

| Component | Depends on | Evidence |
| --- | --- | --- |
| `dispatch.facility` (core) | `dispatch`, `facility` | FKs from `dispatch_job_facility` |
| `edls` | `dispatch.job_group`, `facility` | FKs from `edls_sheets`, migrations, queries |
| `dispatch.bullpen`, `dispatch.department`, `dispatch.fore` | `dispatch` | FKs into `dispatch_jobs`, migrations, queries |
| `dispatch.asi`, `dispatch.dnc`, `dispatch.eba`, `dispatch.hfe`, `dispatch.ban`, `dispatch.singleshift` | `dispatch` | owner-confirmed functional dependencies; these features require dispatch even without an FK |
| `trust.benefits.scan`, `trust.benefits.eligibility.exemptions` (core) | `trust.benefits` | owner-confirmed functional dependencies: benefit eligibility scanning and plugin exemptions |
| `sitespecific.t631.interviews` | `dispatch` | FK into `dispatch_jobs`, queries, raw SQL |
| `grievance.contract` | `grievance`, `contract` | FKs into `grievances`, `contract_sections`; client calls `/api/grievances` |
| `grievance.settlement` | `grievance` | FK into `grievances`; client calls `/api/grievances` |
| `trust.providers.edi` | `system.sftp.client` | FK into the SFTP plugin-config subsidiary |
| `worker.certifications` | `worker.skills` | imports and schema link |
| `worker.tos`, `worker.aat`, `worker.ratings` | `edls` | imports EDLS hooks/storage; `worker.tos` client calls `/api/edls/supervisor-context` |
| `sitespecific.freeman` | `edls` | queries and raw SQL on EDLS tables |
| `sitespecific.freeman.edls_migrate` | `edls`, `sitespecific.freeman` | imports EDLS storage |
| `sitespecific.t631.client` | `edls`, `worker.tos`, `worker.aat` | imports |
| `contract.chat` | `contract` | contract-scoped chat |
| `contract.chat.foray` | `contract.chat` | provider for contract chat |
| `internationalization.weglot` | `internationalization` | provider for translation |

Covered transitively (no new declaration): `sitespecific.freeman` and
`sitespecific.freeman.edls_migrate` import the `dispatch_job_group` and
`facilities` Drizzle tables. Both reach them only through EDLS sheets, and
`edls` hard-depends on `dispatch.job_group` and `facility`, so neither can be
present or enabled without them. `passport-export` also gates the job-group
read with `isComponentEnabledSync("dispatch.job_group")`.

### Soft — runtime-gated

| From | To | Gate |
| --- | --- | --- |
| `dispatch.ban` | `dispatch.facility`, `dispatch.singleshift` | `isComponentEnabled` checks in the facility-ban plugin and verify script |
| `debug` | `dispatch` | eligible-workers SQL route guarded by `requireComponent("dispatch")` (it imports the core `worker_dispatch_status` table and core dispatch eligibility query) |
| `trust.providers.edi` | `sitespecific.bao` | BAO HealthNet/Kaiser file-type plugins declare `requiredComponent: "sitespecific.bao"` |
| `worker.steward` | `sitespecific.btu` | BTU steward-attendance charge plugin and BTU building-rep wizard declare `requiredComponent: "sitespecific.btu"` |
| `sitespecific.t631.client`, `sitespecific.freeman.edls_migrate`, `worker.*`, `contract.chat` | their declared parents | additionally gate routes with `requireComponent` (belt and braces on top of the hard declaration) |
| core | every optional component | core reaches optional components only through generated registration modules, alter hooks, contribution slots and component-enabled checks (enforced by the import rule) |
| core `configuration-revision-ddl` | `trust.providers.edi` | existence-guarded trigger table name for `plugin_configs_trust_provider_edi` (documented retained-data exception) |
| core historical migrations | component tables | authored global migrations that are existence-guarded or scoped to the component's migration runner |

Core-defined components without their own directory (for example `dispatch`,
`cardcheck`, `sitespecific.btu`) have their code in core. Core references to
their tables are their own code and cannot be attributed statically; the
`--audit` listing shows them as `(core) -> <component>`. They become checkable
when the component moves into its own directory.

### Owner decisions (2026-11-26)

All four previously pending questions are resolved:

1. **`dispatch.ban` → `dispatch`** is declared. The original ungated-script
   finding was stale: the script now lives at
   `components/dispatch.ban/scripts/verify-dispatch-eligibility-enforcement.ts`
   and checks that dispatch, ban and single-shift are enabled before querying
   dispatch tables. Keep that runtime preflight in addition to the declaration.
2. **Steward import stays with its owner**, rather than being retired:
   `components/worker.steward/scripts/import-stewards.ts`. Run it with
   `npx tsx components/worker.steward/scripts/import-stewards.ts <steward-csv-path>`.
   Its SQL on `worker_steward_assignments` is now an owner-local reference;
   removing the component removes the tool too. The old core oneoff is removed,
   not kept as a forwarding script.
3. **All six reviewed dispatch children require dispatch**:
   `dispatch.asi`, `dispatch.dnc`, `dispatch.eba`, `dispatch.hfe`,
   `dispatch.ban`, and `dispatch.singleshift` now declare it, like
   `dispatch.bullpen`, `dispatch.department`, and `dispatch.fore`.
   Functional requirements, not only foreign keys, justify a hard dependency.
   Existing route and plugin gates remain as additional protection.
4. **Both benefit children require `trust.benefits`**:
   `trust.benefits.eligibility.exemptions` and `trust.benefits.scan` declare it
   in their core definitions. Exemptions act on benefit eligibility plugins;
   the scan runs benefit eligibility.

These are explicit declarations, not a change to the dotted-ID hierarchy
rule. They do not automatically enable components or change saved settings.
There are no remaining owner-review items from this audit.
