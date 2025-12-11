# Overview

Sirius is a full-stack web application for comprehensive worker management, providing robust CRUD operations and configurable organizational settings. It aims to streamline worker administration, enhance user experience, and deliver significant business value through efficiency and reliability.

# Recent Changes (December 11, 2025)

-   **GBHET Legal Benefit Charge Plugin - Billing Offset**: Added `billingOffsetMonths` configuration setting (default: -3) that allows billing to occur in the work month rather than the benefit month. For example, when a worker uploads hours in January to receive April benefits (3-month offset), the charge is now billed on January 31st (end of work month) instead of April. The plugin metadata now stores `benefitYear`/`benefitMonth` with backward compatibility for legacy `year`/`month` fields in verification.
-   **ConfigFormPage UI**: Added numeric input field for configuring the billing offset on the charge plugin configuration form.
-   **ConfigList UI**: Now displays the billing offset setting alongside account, benefit, and rate information.

# Recent Changes (November 26, 2025)

-   **Worker List Contact Indicators**: Updated workers table to show phone, email, and address as icon indicators instead of full text. Mail icon, Phone icon, and Home icon (green if data exists, gray if not) with hover cards showing the worker name for verification along with the actual contact data. Improves table density while maintaining data accessibility.
-   **Worker List Contact Status Filter**: Added dropdown filter to workers table for filtering by contact information status. Options include: Has/Missing Email, Has/Missing Phone, Has/Missing Address, Complete Contact Info (all three present), and Incomplete Contact Info (missing any). Filter integrates with existing employer and benefit filters.
-   **Worker Benefits CSV Export**: Added current benefits to workers list CSV export. Created new `/api/workers/benefits/current` endpoint that efficiently fetches current month benefits for all workers using PostgreSQL DISTINCT ON with ORDER BY for deduplication. Backend uses double null-safety (SQL COALESCE + Array.isArray guard) to ensure reliable empty arrays for workers without benefits. CSV export includes "Current Benefits" column showing benefit names with employer names, gracefully handling null values.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend uses React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme for a modern and accessible interface.

## Technical Implementations
-   **Frontend**: Wouter for client-side routing, TanStack Query for server state management, and React Hook Form with Zod for forms.
-   **Backend**: Express.js with TypeScript, featuring a RESTful API and a feature-based module structure.
-   **Authentication**: Replit Auth (OAuth via OpenID Connect) with pre-provisioned user access and PostgreSQL-based session management.
-   **Access Control**: Centralized, declarative role-based access control with policies like `employerUser`, `workerUser`, and `admin`.
-   **Logging**: Winston logging with a PostgreSQL backend for comprehensive audit trails of CRUD operations, authentication, and wizard activities.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM for type-safe operations and migrations. Shared Zod schemas ensure consistency.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend) for persistent file storage with public/private access and signed URL generation.

## Database Access Architecture
**CRITICAL**: All database queries MUST occur in the storage layer (`server/storage/`) only. This enforces strict separation of concerns:

-   **Storage Layer** (`server/storage/*.ts`): The ONLY place where direct database access (`db.select()`, `db.insert()`, `db.update()`, `db.delete()`, `db.transaction()`) is allowed.
-   **Route Handlers** (`server/routes.ts`, `server/modules/*.ts`): MUST use storage functions via `storage.*` - never import or use `db` directly.
-   **Pattern**: Routes call storage functions; storage functions query the database.
-   **Logs Storage** (`server/storage/logs.ts`): Centralized log queries with `getLogs()`, `getLogFilters()`, `getLogById()`, `getLogsByHostEntityIds()` supporting filters, pagination, and OR conditions for entityId/hostEntityId.
-   **Wizard Storage** (`server/storage/wizards.ts`): Includes `createMonthlyWizard()` and `createCorrectionsWizard()` with transaction-based race condition prevention.
-   **Exception**: Services in `server/services/` may use storage functions but should not use `db` directly unless absolutely necessary.
-   **Logging Config Co-location**: Each storage module (`variables.ts`, `contacts.ts`, `employers.ts`, etc.) exports its own `StorageLoggingConfig`. The `database.ts` file is a thin orchestrator (~116 lines) that imports configs and composes the `DatabaseStorage` class.

## Feature Specifications
-   **Worker Management**: Full CRUD operations for workers with sequential `sirius_id`.
-   **Configurable Settings**: Manages organizational settings such as worker ID types, work statuses, and employer contact types.
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts.
-   **Data Validation**: Extensive Zod schema validation, `libphonenumber-js` for phone numbers, and custom SSN/date validation.
-   **Employer & Contact Management**: Manages employer records and links them to contacts with type categorization.
-   **Trust Provider Contacts Management**: Full CRUD operations for trust provider contacts with type categorization.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking for workers and employers.
-   **Dashboard Plugin System**: Extensible architecture for customizable dashboard widgets with unified settings storage.
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control.
-   **Routing Architecture**: Consistent routing patterns for configuration and detail pages; reports use a two-tier structure.
-   **Ledger System**: Manages financial transactions with comprehensive features: Accounts, Payments, Transactions (unified viewing with filtering, sorting, pagination, CSV export), Entity-Account (EA) linking, and Payment Allocation. Includes a Ledger Integrity Report to verify ledger entries against charge plugin computations.
-   **Wizards**: Flexible workflow state management for multi-step processes, supporting type-specific steps, status transitions, data validation, and audit logging. Includes "Feed Wizards" for data generation and a Report Wizard Framework for worker data analysis.
-   **File Storage System**: Comprehensive file management with metadata tracking, access control, and RESTful API endpoints.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history with full CRUD and API support, including monthly rate models for charge plugins.
-   **Work Status History Auto-Sync**: Automatically synchronizes worker's current work status based on historical entries.
-   **Employer Policy History**: Tracks policy assignments over time for each employer with date-based history entries. Includes denormalized `denorm_policy_id` on employers table for current policy, auto-synced from history entries. View access for employer users, write access requires admin.
-   **Policy Benefits Configuration**: Each policy has a Benefits tab allowing admins to select which Trust Benefits the policy offers. Selected benefit IDs are stored in the policy's `data` JSON field as `benefitIds` array.
-   **Trust Eligibility Plugin System**: Registry-based plugin architecture for determining worker eligibility for trust benefits. Each plugin defines its own configuration schema and evaluate function. Plugins receive scan type ("start" or "continue"), worker ID with lazy loading, and as-of month/year. Built-in plugins: Work Status (checks if worker has allowed work status), GBHET Legal (checks for nonzero hours in month N months prior). Eligibility rules are stored per-benefit in policy's `data.eligibilityRules` JSON field with `appliesTo` scan type filters.
-   **Benefits Eligibility Scan**: Worker-level scan feature (`/workers/:id/benefits/scan`) that evaluates all policy benefits for a given month/year. Determines worker's effective policy from home employer's policy history or system default. For benefits the worker had in the preceding month, runs "continue" scans; for new benefits, runs "start" scans. Supports test mode (preview changes) and live mode (creates/deletes `trust_wmb` records). Service located at `server/services/benefits-scan.ts`, API module at `server/modules/worker-benefits-scan.ts`.
-   **Database Quickstarts**: Admin-only feature for exporting and importing complete database snapshots as JSON files for rapid environment setup.
-   **Cron Job System**: Complete scheduled task execution framework with registry pattern, database-backed job configuration, and node-cron scheduler. Supports "live" and "test" execution modes and includes default jobs for data cleanup.
-   **System Mode**: Application-wide environment mode setting (dev/test/live) stored in the Variables table. Accessible via `getSystemMode()` utility function on the backend. Displays a badge indicator in the navbar (gray for dev, yellow for test, hidden for live) and configurable via admin-only settings page.

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
-   **Drizzle Zod**: Integration for Drizzle ORM and Zod.
-   **libphonenumber-js**: Phone number parsing, validation, and formatting.

## Third-Party Integrations
-   **Twilio**: Phone number lookup, validation (Twilio Lookup API), and SMS messaging with delivery status webhooks.

## Service Provider Architecture
-   **Service Registry**: Modular provider system supporting multiple service categories (SMS, Email, Postal). Located in `server/services/service-registry.ts`.
-   **SMS Providers**: 
    -   TwilioSmsProvider (`server/services/providers/sms/twilio.ts`): Full SMS and phone validation via Twilio.
    -   LocalSmsProvider (`server/services/providers/sms/local.ts`): Local validation only using libphonenumber-js, no SMS capability.
-   **Configuration**: Provider settings stored in Variables table with key `service_config:sms`. Supports runtime provider switching and per-provider configuration.
-   **Orchestration Layers**: `sms-sender.ts` handles business logic (opt-in, allowlist, system mode) and delegates to the active provider.
-   **Phone Validation Consolidation**: Phone validation settings are consolidated with SMS provider selection. The PhoneValidationService uses the active SMS provider for validation (Twilio Lookup for 'twilio' mode, libphonenumber-js for 'local' mode). Settings are stored per-provider: defaultCountry/strictValidation in 'local' provider, lookupType/fallback flags in 'twilio' provider. Legacy API (`/api/variables/phone_validation_config`) maintained for backward compatibility.
-   **Phone Validation Storage**: Validation results are stored in `comm_sms_optin` table (unique on phone_number) to deduplicate validation across contacts sharing the same number. The table stores sms_possible, voice_possible, validated_at, and full validation_response. The `ensureSmsOptinWithValidation` helper auto-creates/updates opt-in records when phone numbers are created or updated. A `/api/phone-numbers/:id/revalidate` endpoint allows on-demand refresh of validation data.
-   **SMS Delivery Status Tracking**: Comprehensive status callback system for tracking SMS delivery status via Twilio webhooks. Architecture uses base `CommStatusHandler` class pattern for extensibility across communication types (SMS/email/postal). Status callback URL (`/api/comm/statuscallback/:commId`) is embedded in outbound SMS requests. Status updates are logged via winston_logs with `entity_id=commId` and `host_entity_id=contactId` for proper audit trails. Twilio callbacks are validated using HMAC signature verification with the `X-Twilio-Signature` header. Frontend displays real-time status badges (Sending, Sent, Delivered, Failed) with visual differentiation.

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.
-   **@innova2/winston-pg**: Winston transport for PostgreSQL logging.

## Task Scheduling
-   **node-cron**: Task scheduling and cron job execution.

## Security
-   **DOMPurify**: HTML sanitization.