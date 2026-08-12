# Porting Spec: Worker List & Employer List (current state)

Purpose: feed this document to an agent working on a slightly out-of-sync copy of the Sirius codebase so it can bring its Worker list and Employer list up to parity with this workspace. It describes target behavior and where each piece lives; the other agent should adapt to its local file state rather than blindly copy line numbers.

---

## 1. Worker List

### Files
- `client/src/pages/workers.tsx` — page shell, query/pagination state.
- `client/src/components/workers/workers-table.tsx` — search controls, filters, table.
- `server/routes.ts` (~lines 521–606) — endpoint registration + query-param parser.
- `server/storage/workers.ts` — `_searchWorkers` SQL, params/result types, sorting.

### Page layout (`workers.tsx`)
- Full-screen background; `PageHeader` with "Workers" title + users icon; count badge `{total} Workers`; bulk action via `ListBulkAction`.
- Tabs: **List** and staff-only **Add**.
- Main content `max-w-7xl` containing `WorkersTable`.
- Fixed `pageSize = 50`. Query key: `["/api/workers/with-details/paginated", { page, pageSize, ...filterParams }]`.

### Two-field search (key recent change)
Two separate inputs plus a single **Apply** button:
- **Name/ID input** — placeholder `Name, Sirius ID, or worker ID...`, test id `input-search-name-id`.
- **Contact input** — placeholder `Email, phone, or address...`, test id `input-search-contact`.
- Apply button test id `button-apply-search`. Pressing Enter in either input applies.
- **Pending vs applied state are separate.** Typing never triggers a server refetch; Apply copies pending nameId/contact/filter values into applied state and resets to page 1. Sort changes take effect immediately (no Apply needed).
- Row selection clears whenever the serialized effective filter signature changes. "Select all matching" hits `GET /api/workers/with-details/all-ids` with the identical filter params and returns `{ contactIds, total }`.

### Server search semantics (`_searchWorkers` in `server/storage/workers.ts`)
- Each field's text is split on whitespace; **every term must match (AND)**, each term may match any of the field's columns (OR).
- Name/ID terms match: `lower(display_name)`, given name, family name, `sirius_id` cast to text, or **enabled** worker IDs — join `worker_ids` to `options_worker_id_type` where `(data->>'showOnLists')::boolean = true`.
- Contact terms match: lowered email, active phone (raw, or digit-normalized when the term has ≥3 digits), or active postal street/city/state/postal_code.
- Both fields' conditions are concatenated, so the two fields are ANDed together.
- Client-side equivalent filtering exists only for the non-paginated table usage inside `workers-table.tsx`; the main list is fully server-side.

### Sorting
- Controls: sortBy `lastName` | `firstName` | `employer`, direction A-Z/Z-A.
- SQL orders by family/given, given/family, or `MIN(employer name)` then family/given.

### Filters (all follow the Apply-button model)
- Employer select on its own row — active employers from `/api/employers`, type icons from `/api/options/employer-type`.
- Trust benefit select (only when `trust.benefits` component enabled; `/api/trust-benefits`).
- Contact status: `all`, has/missing email, phone, address, complete/incomplete.
- "Multiple Employers" checkbox.
- Job title text input.
- Member status (cardcheck component only; `all`, `none`, options from `/api/options/worker-ms`).
- Representative (political component only; `/api/sitespecific/btu/political/officials`).
- Bargaining unit (`/api/bargaining-units`).
- Component config from `/api/components/config`; cardcheck data from `/api/cardchecks/status-summary` and `/api/cardcheck/definitions`.

### Server query params (parser in `server/routes.ts`)
`nameIdSearch`, `contactSearch`, `sortOrder`, `sortBy`, `employerId`, `employerTypeId`, `bargainingUnitId`, `benefitId`, `contactStatus`, `hasMultipleEmployers=true`, `jobTitle`, `memberStatusId`, `representativeId`.
- Value `all` normalizes to `undefined`; `page` clamped ≥1; `pageSize` default 50, cap 100.

### Visual/layout tweaks in the latest revision
- Member statuses render smaller and stacked.
- Worker IDs are folded into the name column (no separate ID column).
- Tighter overall table layout.

---

## 2. Employer List

### Files
- Client: employers list page + `client/src/components/employers/bulk-update-employers-dialog.tsx`.
- Server: `server/modules/employers/employers.ts` (modular routes, registered from `server/routes.ts` ~line 1495); legacy routes remain in `server/routes.ts` (~1362–1415).
- Storage: `server/storage/employers/employers.ts`, `server/storage/employers/contacts.ts`, `server/storage/worker-hours.ts`, `server/storage/trust/wmb.ts`.

### Gating
- Page is staff-only in practice: list + auxiliary endpoints require auth + `requireAccess('staff')`.
- Component visibility via `useAuth()`: company column/fetches gated on `employer.company`; benefit counts gated on `trust.benefits`.
- `hasPermission("staff")` controls row selection and the bulk-update button/dialog.
- Detail: `GET /api/employers/:id` uses `employer.view` entity access; mutations (`PUT /api/employers/:id`) require `requirePermission("staff")`. `/api/companies` routes are staff-gated.

### Endpoints
1. `GET /api/employers` (`server/modules/employers/employers.ts`)
   - Query `includeInactive === 'true'` includes inactive; otherwise filters `isActive` in memory after `storage.employers.getAllEmployers()` (unfiltered `SELECT * FROM employers`).
   - Enrichment (`enrichEmployersList`): batch-loads industries (`unifiedOptionsStorage.list("industry")`), all employer policy history + policies; resolves current policy as-of today via `resolveEmployerPolicyAsOf` cache; adds `industryName`, `currentPolicyId`, `currentPolicyName`. When `employer.company` is enabled, joins `storage.employerCompanies.getAllWithCompanyName()` to add `companyId`/`companyName`; a missing company table is tolerated (returns non-company-enriched rows).
   - No server-side limit/offset/order — search/sort/filter/pagination are client-side.
2. `GET /api/employers/counts`
   - `storage.workerHours.getDistinctWorkerCountsByEmployer()` → `workerCounts`.
   - If `trust.benefits`: `storage.trust.wmb.getActiveBenefitWorkerCountsByEmployerLatestPeriod()` → nested `benefitCounts[employerId][benefitId]`.
   - Response `{ workerCounts, benefitCounts }`. (A legacy duplicate exists in `routes.ts`; the modular one should be the survivor.)
3. `GET /api/employers/contact-indicators` (legacy `routes.ts` registration is the effective one)
   - `storage.employerContacts.getContactIndicatorsByEmployer()`, grouped by employer id; rows carry `contactId`, `name`, `type`, `icon`, `hasActiveUser`.

### Bulk update dialog
- Staff-only. Fields: Industry, Type, optional Company, Active.
- "Leave unchanged" sentinel = field omitted; "None" sends `null`.
- Loads `/api/options/employer-type` and `/api/options/industry` on open.
- Issues parallel `PUT /api/employers/:id` calls with the notification-suppression header, invalidates `/api/employers`, reports partial success, resets selection.

---

## 3. Porting notes for the receiving agent

- Do not copy line numbers verbatim — locate by symbol/route name.
- **Route order:** any literal `/api/employers/<word>` route must be registered before `/api/employers/:id` or it gets captured as `:id` → 404.
- If your copy still has a single worker search box, replace it with the two-field pending/applied model described above, including the server-side `nameIdSearch`/`contactSearch` params and the `_searchWorkers` AND/OR term semantics.
- Ensure `worker_hours` has an index on `worker_id` (`worker_hours_worker_id_idx`) if running loaders/counts at scale.
- No schema migrations are required for these list changes themselves; they are UI + route/storage query changes only.
- Regression guard: a check exists here confirming the two-field search can't quietly break (Name/ID vs Contact separation). Consider adding an equivalent test on the receiving side.
