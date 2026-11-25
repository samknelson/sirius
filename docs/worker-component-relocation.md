# Worker child component relocation

This is a **relocation-only, core-registered stage**, not support for deleting
worker component source. All nine IDs are still defined in
`shared/components.ts`, with the same permissions, gates, dependencies, schema
versions and table ownership. Their directories use `coreRegistered: true`;
the eight schema-owning directories list their relocated schema module.

## Inventory

Paths below are relative to `components/<id>/`. All 60 relocated files retain
their original host-relative paths; there are no duplicate implementations in
core.

| Component | Files | Relocated implementation |
| --- | ---: | --- |
| `worker.login` | 0 | Manifest only. There is no clearly exclusive login implementation. Shared authentication, account administration, user linking and role configuration remain in core. |
| `worker.steward` | 11 | `shared/schema/worker/steward/schema.ts`; `shared/access-policies/employer/steward-view.ts`; `server/{modules,storage}/worker-steward-assignments.ts`; server dashboard `my-steward` and event notifier `steward-assignment-notifier`; pages `worker-steward`, `stewards`, `employer-stewards`, `config/steward-settings`; dashboard `my-steward/MySteward.tsx`. |
| `worker.skills` | 4 | `shared/schema/worker/skills/schema.ts`; `server/{modules,storage}/workers/skills.ts`; page `worker-skills.tsx`. |
| `worker.certifications` | 7 | `shared/schema/worker/certifications/schema.ts`; `server/{modules,storage}/workers/certifications.ts`; pages `worker-certifications`, `worker-certification-view`; `WorkerCertificationLayout`; cron plugin `workerCertificationActiveScan`. |
| `worker.badges` | 8 | `shared/schema/worker/badges/schema.ts`; `server/modules/workers/badges.ts`; `server/storage/system/worker-badges-denorm.ts`; page `workers/badges.tsx`; denorm plugin `workerBadgeFromNote`; both badge-only test files; historical component migration. |
| `worker.ratings` | 13 | `shared/schema/worker/ratings/schema.ts`; `server/{modules,storage}/workers/ratings.ts`; page `worker-ratings.tsx`; wizard wrapper `worker-ratings-import`, engine `worker_ratings_import`, and its five browser modules; historical component migration; `scripts/oneoffs/test-1334-ratings-import.ts`. |
| `worker.tos` | 8 | `shared/schema/worker/tos/schema.ts`; `server/{modules,storage}/workers/tos.ts`; pages `worker-tos`, `config/config-workers-tos`; `client/src/lib/worker-tos-banner.ts`; denorm `tosAbsenceReminder`; event notifier `tos-absence-notifier`. |
| `worker.aat` | 5 | `shared/schema/worker/aat/schema.ts`; `server/{modules,storage}/workers/aat.ts`; page `worker-aat.tsx`; historical component migration. |
| `worker.relations` | 4 | `shared/schema/worker/relations/schema.ts`; `server/{modules,storage}/workers/relations.ts`; page `workers/relations.tsx`. |

## Retained integration, by component

Core still explicitly owns route invocation (`server/routes.ts`), storage
construction and logging configuration (`server/storage/database.ts`), browser
routes (`client/src/App.tsx`), schema aggregation (`shared/schema.ts`), tab and
navigation definitions, option metadata, variable configuration, permissions,
and record-history/token integration. Import targets changed; registration
ownership and ordering did not.

- **Login:** worker account/user pages and `server/modules/workers/users.ts`,
  auth providers, role configuration and the main worker layout remain shared.
- **Steward:** the core policy loader still imports the employer-view policy;
  the dashboard and notifier loaders still import the self-registering
  implementations. Menu entries, terminology, variables, options, roles and
  worker/employer layout integration stay central. The BPS steward import and
  site-specific attendance/charge behavior remain with their existing owners.
- **Skills:** generic options, dispatch eligibility and dispatch skill denorm
  consumers stay where they were. The latter imports the relocated storage.
- **Certifications:** the central cron loader still imports the self-registering
  expiry scanner. The certification-to-skills dependency is still supplied by
  the storage aggregate; its type is obtained from that core contract, not a
  new cross-component dependency. Certification tabs remain central.
- **Badges:** denorm registration remains a side-effect import in the core
  loader; storage is still constructed/exported by the core aggregate. Unified
  options, record-go presentation, notes, websocket delivery and badge type
  metadata stay integrated through their existing shared systems.
- **Ratings:** the core wizard loader still imports the self-registering
  wrapper. The engine and browser modules continue using the shared feed
  framework, worker identifier choices and file services. Options stay central.
- **TOS:** the worker layout still uses the banner helper; variable declarations,
  EDLS TOS endpoints and T631 synchronization stay with their existing owners.
  The core storage barrel re-exports the same `WorkerTosConflictError` class for
  T631's existing `instanceof` checks, avoiding a new undeclared component
  dependency. Core denorm/notifier loaders keep the existing side-effect imports.
- **AAT:** worker access-token routes/storage moved, but EDLS bearer-link
  authorization, schedule cards, token producers and notifiers did not.
- **Relations:** generic relation options, shared worker/contact infrastructure
  and tab definitions remain central.

### Fixed-glob forwarding modules

Only these six old browser entry points remain, each re-exporting its relocated
module:

- `client/src/plugins/dashboard/my-steward/MySteward.tsx`
- `client/src/plugins/wizards/worker_ratings_import/{RatingsConfigure,RunView,FeedUpload,FeedMap,FeedResults}.tsx`

The dashboard and wizard registries and their fixed globs are unchanged.
The four already-shared ratings feed views remain simple shared-UI re-exports
inside the component, with the old glob entries forwarding to those modules.

### Schema and historical migrations

Schema paths in the core definitions and the generated schema loaders point at
the eight component-local modules. Tables, columns, constraints, schema versions
and migration SQL are unchanged. `scripts/migrate/index.ts` still explicitly
imports the same three historical registrations, now under their owning
directories:

| Component | Version | Name |
| --- | ---: | --- |
| `worker.aat` | 1 | `create_worker_aat` |
| `worker.badges` | 1 | `create_worker_badges` |
| `worker.ratings` | 1 | `add_sirius_id_to_options_worker_ratings` |

There is no new migration, DDL, data repair or runtime schema operation.
The author-time migration check recognizes the moved historical modules; they
are not new migrations. If a rename-aware review requires the documented
`[skip-migration-check]` exception, its justification is strictly that schema
declarations and migration bodies are unchanged except for module paths.

## Verification and deferred work

- Discovery and the production build succeeded.
- Both relocated badge suites passed: 43 existing checks, unchanged assertions.
- A throwaway fixture-render smoke check passed for 13 pages in staff/non-staff
  contexts and the populated steward widget (27 cases). Layout/auth/query
  fixtures isolate rendering; this is not an authenticated end-to-end CRUD test.
- In the actual proxied Vite browser, all 14 relocated page/layout modules loaded,
  `my-steward:MySteward` resolved, and all five ratings wizard component IDs
  resolved through the unchanged core globs.
- The normal sign-in page rendered after restart. Real signed-in record pages
  were not visually verified; no auth bypass or stored enablement change was used.
- Import-boundary checks cover the new directories. Existing typecheck, Vitest,
  Tailwind, storage and maintenance scans already support component paths.
  The denorm sole-writer sweep now exempts component-local storage exactly as it
  exempts core storage, while continuing to scan relocated denorm implementations.
- The ratings one-off was moved, not executed. No new permanent tests were added.

Already-working self-registration needs no replacement in this stage. Future
removability would require separately reviewed decisions about explicit host
routes/storage/policies/schema/config integration and fixed-glob browser entry
points. This handoff identifies those boundaries; it does not select or approve
a new registration framework, callback contract, hook design or removal policy.
