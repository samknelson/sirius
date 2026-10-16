# Worker communications compliance integration

## Provenance and compatibility

Reference archive: `attached_assets/worker-comms-compliance-1140796ab763_1792166217253.zip`.
Its manifest identifies source `1140796ab763f4aab7f543f0afbc75c644f767af`
and pre-feature baseline `8b55ed1fa3d0bb014c80fa342e02c15241aa3be1`.
The archive's README, integration instructions, manifest, source/base pairs and
scoped patch were inspected. Its read-only verifier passed integrity for all 40
artifacts and reconstruction for 22 sources; all nine shared integration points
were different in this repository. The missing existing-draft chooser
prerequisite was implemented rather than assuming the archived baseline existed.
No Git objects or saved definitions were imported; no shared file was overwritten
with its archived version.

Reconciliation decisions:

- `shared/components.ts`: add `worker.comms_compliance`, disabled by default,
  no component-owned schema. No automatic enablement.
- `server/storage/workers.ts`: extract the target's existing population predicate,
  retaining SSN/name/phone/postal search, activity checks, benefit-role filters,
  display columns and export/keyset traversal. Only report callers supply
  historical benefit month bounds or multi-status/multi-benefit alternatives.
- `server/storage/database.ts`: add the read-only report namespace, preserving
  every existing namespace and storage logging wrapper.
- `server/modules/bulk/messages.ts`: retain existing new-draft defaults and
  bulk behavior; add a literal eligible-drafts route before the dynamic ID route.
  Both list handoffs share a transactional service and effective-user resolution.
- `server/routes.ts`: register the separate, staff-gated report API.
- `server/plugins/dashboard/index.ts`: add one component/staff-gated plugin;
  existing dashboard registry behavior stays intact.
- `server/plugins/menu/plugins/default.ts`: add a component/staff-gated Workers item.
- `client/src/App.tsx`: add the literal protected report route before dynamic
  worker routes without changing other routes.
- `client/src/components/bulk/list-bulk-action.tsx`: retain selected/all-matching
  and new-draft behavior, adding an optional report-selection envelope and an
  eligible existing-draft chooser for ordinary list callers too.

The target's modular schemas, communication statuses and escaped variable-prefix
lookup already support the feature, so neither `shared/schema.ts` nor
`server/storage/system/variables.ts` needed replacement. Target-specific
adaptations include nullable Sirius IDs and calendar-only month formatting.

## Safety boundaries

Definitions use `worker_comms_compliance_definition:` variables. References and
prerequisite components are checked on report reads and again on handoff.
Communication sent-date bounds do not change monthly benefit membership.
The report, contact selection and dashboard use the same query/count semantics.
One communication must satisfy all evidence conditions.

Existing handoffs lock the draft row before validation and recipient writes.
New handoffs validate before creating anything. Contact/channel pairs are
deduplicated, all mutations share one transaction and existing unique constraints
remain authoritative. A conflict returns 409 rather than partially adding rows.
Delivery marks the draft as permanently started before contacting a vendor,
using the same parent-row lock. This marker survives settings saves and recipient
deletion. Queued, sent or started drafts cannot receive handoff recipients.
The handoff itself has no delivery call.

No database migration, source record import, authentication change, postal/CSV
change, communication send, production access or publication was performed.

## Verification (2026-10-16)

- `npm run check`: server and client TypeScript passed.
- `npm run lint`: all target architectural rules passed.
- `npx vitest run tests/comm tests/workers/worker-benefit-role-filters.test.ts tests/workers/worker-export-role-filter-validation.test.ts`:
  communication suites and ordinary worker-filter regression checks.
- Development SQL tests ran, not skipped: real target schema/options/report
  query in a read-only transaction, monthly-history scenarios in temporary
  tables, and bulk storage/handoff in temporary tables cloned from the real
  target shape and indexes. All fixtures roll back. Tests are guarded to the
  local development database and skip on nonlocal/production targets.
- `npm run test:browser:worker-comms-compliance`: isolated browser fixtures
  exercise actual React components with authenticated admin/staff responses,
  component-off routing, benefit month modes, counts, help details, both draft
  request paths, chooser retry and stale-selection rejection. Unexpected APIs
  are failures; no sending endpoint is handled or called.
- Help tests cover sanitization and exact page matching, including near misses.
- `Start application` restarted and reached fully initialized status; the real
  `/workers/comms-compliance` screenshot shows the expected unauthenticated
  sign-in screen. Fixture screenshots are ignored under
  `generated-artifacts/worker-comms-compliance/`.

### Explicit remaining verification boundary

There was no authorized signed-in browser session available for the running
application. Browser fixtures are **not** real signed-in end-to-end tests:
live admin/staff permissions, normal enable/disable configuration, real saved
definitions, dashboard/menu visibility and real-database draft creation still
need an authorized no-send smoke run. The component stays disabled by default.
Use development data only, inspect monthly windows/counts, try both draft
destinations, confirm no deliveries begin, and remove test definitions/drafts
through normal UI operations afterward. Do not treat these unverified live
checks as passed or enable the component automatically.
