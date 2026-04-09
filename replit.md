# Overview

Sirius is a full-stack web application for comprehensive worker management. Its purpose is to streamline worker administration, enhance user experience, and deliver business value through efficient and reliable operations. Key capabilities include robust CRUD operations, configurable organizational settings, legal compliance reporting, benefit charge billing, and detailed worker contact management. The project aims to provide a reliable, efficient, and user-friendly platform for worker administration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend uses React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme for a modern, accessible, and responsive interface.

## Technical Implementations
-   **Frontend**: Wouter for routing, TanStack Query for server state, React Hook Form with Zod for forms. Pages are lazy-loaded.
-   **Backend**: Express.js with TypeScript, RESTful API, and a feature-based module structure.
-   **Authentication**: Multi-provider authentication supporting Replit Auth (OIDC), Okta, SAML/OAuth, Clerk, and local username/password. Environment-driven configuration and multi-link account capabilities are supported via an `auth_identities` table. Session management uses PostgreSQL. Clerk integration uses `@clerk/clerk-react` (frontend) and `@clerk/express` (backend). To enable Clerk: set `AUTH_PROVIDER=clerk`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (backend), and `VITE_CLERK_PUBLISHABLE_KEY` (frontend).
-   **Masquerade Support**: Administrators can assume the identity of other users. All backend endpoints accessing user-specific data must use `getEffectiveUser()` to ensure correct user context.
-   **User Resolution**: `resolveDbUser` centralizes user lookup via `auth_identities`, caching results and supporting active-user checks.
-   **Access Control**: Modular, entity-based policy architecture with server-side LRU caching. Policies can be component-defined, declarative, or modular, supporting composite rules and preventing recursion. Virtual entity support handles create operations.
-   **Logging**: Winston logging with a PostgreSQL backend for audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend) for persistent file storage.
-   **Real-time Notifications**: WebSocket-based push notification system.
-   **Event Bus System**: Typed publish/subscribe event bus.
-   **Cron Job System**: Scheduled task execution framework.
-   **Migration Framework**: Versioned database migration system.

## Database Access Architecture
All database access **MUST** go through a centralized storage layer (`server/storage/`) to ensure audit logging, access control, consistent validation, and potential backend interchangeability. Direct `db` imports outside the storage layer are forbidden. The storage layer supports transaction contexts via `runInTransaction()` and `getClient()`, ensuring atomicity across multiple storage module operations. Raw SQL for DDL operations is exposed via `storage.rawSql`.

**Read-Only Access for Reports**: For report generation that needs direct query access without write capabilities, use `storage.readOnly.query(async (db) => { ... })`. This wraps queries in a PostgreSQL read-only transaction (`SET TRANSACTION READ ONLY`) that blocks any write attempts at the database level.

**Encapsulation Enforcement**: Run `npx tsx scripts/dev/check-storage-encapsulation.ts` to detect violations. The script detects both static imports (`from '../db'`) and dynamic imports (`await import('../../db')`) outside the allowed storage layer.

**Storage Validation Framework**: Use `createStorageValidator` (sync) or `createAsyncStorageValidator` (async) from `server/storage/utils/validation.ts` to create reusable validators. Validators export `validate()` (returns result) and `validateOrThrow()` (throws `DomainValidationError`). Async validators support DB lookups and external service calls. Examples: `contacts.ts` (address/email validation), `comm.ts` (phone validation with E.164 formatting), `workers.ts` (SSN format and uniqueness), `cardchecks.ts` (duplicate prevention).

**Denormalized Active Status Utility**: Use `calculateDenormActive` from `server/storage/utils/denorm-active.ts` to compute `denormActive` flags based on date ranges. Default behavior: returns `true` if today is within `startDate`-`endDate` range (null start = always started, null end = never expires). Supports `requireStartDate`/`requireEndDate` options to mandate non-null dates, and a `customize` callback for additional predicates (e.g., `status === 'granted'`). Used by `worker-bans.ts` (simple endDate check) and `worker-certifications.ts` (with status customization).

**Ymd Date Handling Framework**: For "date-only" fields where timezone conversion must be avoided (e.g., EDLS sheet dates), use the Ymd utilities from `shared/utils/date.ts`. The `Ymd` type is a string in `YYYY-MM-DD` format. Key functions: `formatYmd(ymd, format)` for display (uses Zeller's congruence for weekday calculation - no Date objects), `getTodayYmd()` for current date, `compareYmd(a, b)` for ordering, `isYmdInRange(ymd, start, end)` for range checks. **CRITICAL**: Never pass Ymd values through `new Date()` as this reintroduces timezone conversion. Database columns storing date-only values should use the `ymd` naming convention and Drizzle's `date()` type which stores as string.

## System Design Choices
-   **Worker Management**: Comprehensive CRUD for workers, contacts, and benefits.
-   **Configurable Settings**: Consolidated options system (`/api/options/:type`) for organizational settings, using a unified metadata-driven storage and registry. The backend provides field definitions via `/api/options/:type/definition` which the frontend `GenericOptionsPage` component consumes to dynamically render forms and tables. A single dynamic route (`/config/options/:type`) handles all migrated options pages - adding new option types requires only backend registry updates, zero frontend changes. Field metadata supports: `inputType` (text, textarea, number, icon, checkbox, select-self, select-options), `dataField` (stored in JSON column), `showInTable`, `supportsParent` (hierarchical), `supportsSequencing` (reorderable), `requiredComponent` (component-based access control).
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts and automatic contact record synchronization.
-   **Data Validation**: Extensive Zod schema validation and `libphonenumber-js`.
-   **Employer & Policy Management**: Manages employer records, contacts, and policy assignments with historical tracking.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking.
-   **Dashboard Plugin System**: Extensible architecture for customizable widgets.
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control.
-   **Ledger System**: Manages financial transactions including accounts, payments, and integrity reports, with entity-specific access policies. Payments support `statementMonth`/`statementYear` fields for tracking the billing period, and a `ledger_payment_allocations` table for splitting a single payment across multiple entity accounts (EAs). The allocation system uses `replaceForPayment` semantics and generates stable charge plugin keys based on `paymentId:ledgerEaId`. When allocations exist, charge plugins fire once per allocation; otherwise backward-compatible single-EA behavior applies. Payment creation uses a dedicated page (`/ledger/accounts/:accountId/payments/new`) opened in a new browser tab from the account payments list. Both create and edit pages use `ParticipantAllocationBox` components with `StatementPicker` for per-participant statement-based allocation. Field order: Payment Type, Amount, category-specific fields, Date Received, Date Cleared, Memo, then Participant Allocation section. **Account Summary**: EA detail pages include an "Account Summary" tab (`/ea/:id/summary`) showing a spreadsheet-style grid of financial data across 6 months (configurable up to 36 via `?months=N`). Rows: Incoming Balance, Charges, Adjustments, Interest & Penalties, Payments Credited, Unpaid Amount, Statement Balance. Payment/adjustment amounts are derived from `payment-simple-allocation` ledger entries for consistency with the ledger balance. Payment details (check #, date received) come from the payments table. The `unpaidStatementAmount` formula includes all components: charges + adjustments + interest/penalties + payment credits (credits are negative).
-   **Wizards**: Flexible workflow state management for multi-step processes and report generation. Access control: all wizard endpoints (CRUD, step navigation, type metadata, file uploads) support both admin and employer access. Non-admin access uses `employer.mine` policy (entity-scoped, requires entityId) for instance-specific operations (create, view, edit, delete, step nav) and the `employer` permission for metadata endpoints (wizard-types list, steps, statuses, fields, launch-arguments). The `checkWizardAccess` middleware handles file upload authorization. Frontend `/wizards/:id` route requires only authentication; the API enforces authorization. Includes an Employer Onboarding Wizard (`employer_onboarding` type) with 5 steps: employer name, attributes (type/industry/benefits/ledger accounts), contacts (with promote-to-user toggle for Clerk provisioning), worker load (creates employer then optionally spawns child GBHET Legal wizard), and review. Processing endpoint: `POST /api/wizards/:id/employer-onboarding/process`. Backend: `server/wizards/types/employer_onboarding.ts`, `server/modules/employer-onboarding-wizard.ts`. Frontend steps: `client/src/components/wizards/steps/employer-onboarding/`.
    -   **Employment Status Mapping**: GBHET Legal wizards support mapping unrecognized employment statuses from uploaded files to system statuses. When validation finds statuses that don't match any system employment status, they are collected as `unmappedStatuses` in the validation results. The UI presents an amber mapping card with dropdowns allowing users to map each unrecognized status to a system status. Mappings are persisted per-employer in the `wizard_employment_status_mappings` table (unique constraint on employerId+sourceStatus) and reused across future uploads. Endpoints: `POST /api/wizards/:id/status-mappings` (save mappings, requires auth + wizard access), `GET /api/wizards/:id/status-mappings` (fetch existing mappings), `GET /api/employment-status-options` (system status dropdown options). The validate step blocks completion while unmapped statuses remain. Storage: `server/storage/wizard-employment-status-mappings.ts`. Frontend: `client/src/components/wizards/steps/gbhet-legal-workers/ValidateStep.tsx`.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history with work status auto-sync.
-   **Trust Eligibility Plugin System**: Registry-based architecture for worker eligibility determination and benefits eligibility scans.
-   **Events Management**: Full CRUD for events, occurrences, and scheduling.
-   **Database Quickstarts**: Admin-only feature for database snapshot export/import.
-   **System Mode**: Application-wide environment mode setting (dev/test/live).
-   **Staff Alert Configuration & Sending System**: Reusable system for configuring and dispatching multi-media alerts.
-   **Terminology Framework**: Site-specific terminology customization.
-   **Dispatch System**: Manages dispatch jobs, job types, listings, and detail pages with various statuses. The dispatch eligibility plugin system (`server/services/dispatch-elig-plugins/`) filters eligible workers based on configurable criteria including bans, skills, work status, do-not-call lists, HFE rules, and custom status rules. Each plugin listens to event bus events and maintains denormalized eligibility data in `worker_dispatch_elig_denorm` for efficient query-time filtering. Job types can configure `eligibleWorkStatuses` via the options UI to restrict dispatch eligibility to specific work statuses.
-   **Worker Bans**: Tracks worker restrictions and dynamically calculates active status.
-   **Worker Member Status History**: Tracks worker member statuses per industry over time via the `worker_msh` table. Workers can have multiple member statuses (one per industry), with a unique constraint on (workerId, industryId, date). The `denormMsIds` array on workers stores current member status IDs for quick lookup, automatically synced when msh entries change.
-   **HTA Union/Apprentice Import**: Site-specific feed wizard (`hta_union_import`, component `sitespecific.hta`) for importing worker data from spreadsheets. Launch argument selects member status type (Union/Apprentice). Imports SSN, names, work status, employer, employment type, contact info. Validates employer names against existing employers. For Union imports, Status/Reason is required and validated against work status options; for Apprentice, work status is always "Active". Work status effective date is always today. After Union import, an inactivity scan runs automatically. Manual scan available at `POST /api/sitespecific/hta/inactivity-scan`. The inactivity scan only deactivates workers whose current work status is Active and whose last Active entry is >3 months old.
-   **Worker Certifications**: Manages worker certifications with automatic skill sync. When certifications are saved, skills are automatically granted based on active certification status. Worker reassignment properly syncs skills for both old and new workers. Manually assigned skills are preserved (only certification-managed skills are affected).
-   **EDLS (Employer Day Labor Scheduler)**: Manages day labor scheduling with sheets, crews, department-based task assignment, supervisor tracking, and comprehensive audit logging. EDLS-specific worker queries (e.g., `getAvailableWorkersForSheet` with assignment status lateral joins) live in `edls-assignments` storage, not in workers storage. This keeps the workers storage clean of EDLS domain logic. The Assignments page includes a hierarchical rating filter that shows workers with specific ratings, displays star ratings next to worker names, and shows rating statistics (total sum and average) for both individual crews and the entire sheet when a rating filter is active. Workers in the available workers panel are grouped by member status (based on the EDLS employer's industry), using the `denormMsIds` array to efficiently look up each worker's current member status via UNNEST and joining with `options_worker_ms`. Groups are ordered by member status sequence.
-   **Web Services Framework**: Server-side API framework for exposing services to external clients. Features bundle-based organization (`ws_bundles`), client credential authentication (`ws_clients`, `ws_client_credentials` with bcrypt-hashed secrets), and optional IP allowlisting (`ws_client_ip_rules`). Authentication middleware extracts credentials from `X-WS-Client-Key`/`X-WS-Client-Secret` headers or HTTP Basic Auth. The first bundle is "EDLS Server Service" (`/api/ws/edls/sheets`) for querying sheets by status and date. Admin endpoints at `/api/admin/ws-*` manage bundles, clients, credentials, and IP rules. To seed the EDLS bundle and test client: `npx tsx scripts/seed-ws-edls-bundle.ts`.

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
-   **Drizzle Zod**: Drizzle ORM and Zod integration.
-   **libphonenumber-js**: Phone number parsing, validation, and formatting.

## Third-Party Integrations
-   **Twilio**: Phone number lookup, validation, and SMS messaging.

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.

## Task Scheduling
-   **node-cron**: Task scheduling and cron job execution.

## Security
-   **DOMPurify**: HTML sanitization.