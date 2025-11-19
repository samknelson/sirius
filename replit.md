# Overview

Sirius is a full-stack web application for comprehensive worker management, providing robust CRUD operations and configurable organizational settings. It aims to streamline worker administration, enhance user experience, and deliver significant business value through efficiency and reliability.

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

## Feature Specifications
-   **Worker Management**: Full CRUD operations for workers with sequential `sirius_id`.
-   **Configurable Settings**: Manages organizational settings such as worker ID types, work statuses, and employer contact types.
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts.
-   **Data Validation**: Extensive Zod schema validation, `libphonenumber-js` for phone numbers, and custom SSN/date validation.
-   **Employer & Contact Management**: Manages employer records and links them to contacts with type categorization.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking for workers and employers.
-   **Dashboard Plugin System**: Extensible architecture for customizable dashboard widgets with unified settings storage and a generic settings API. Includes plugins for welcome messages, bookmarks, employer monthly uploads, and reports. The Reports plugin displays role-configured report cards showing the latest run information (date, record count) with links to detailed results.
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control.
-   **Routing Architecture**: Consistent routing patterns for configuration and detail pages. Reports use a two-tier structure: `/reports` displays report type cards with summary information, while `/reports/:reportType` shows all reports of a specific type with creation controls.
-   **Ledger System**: Manages financial transactions using a `ledger_payments` table.
-   **Wizards**: Flexible workflow state management for multi-step processes, supporting type-specific steps, status transitions, data validation, and audit logging. Includes specialized "Feed Wizards" for data generation with CSV/JSON serialization, batch processing, and user-specific column mapping preferences. Features robust step completion validation and launch constraints to ensure data integrity and prevent race conditions. Report outputs are stored in `wizard_report_data` for clear separation from wizard state.
-   **File Storage System**: Comprehensive file management with metadata tracking, access control, and RESTful API endpoints.
-   **Report Wizard Framework**: Extensible framework for worker data analysis, featuring a three-step workflow (Inputs → Run → Results) and dual storage architecture for report metadata and results. Supports flexible primary keys per report type via `getPrimaryKeyField()` and `getPrimaryKeyValue()` methods in the WizardReport base class. Report metadata includes `primaryKeyField` to track which field is used as the unique identifier. Supports re-run functionality and includes concrete implementations like `ReportWorkersMissingSSN` (pk: workerId), `ReportWorkersInvalidSSN` (pk: workerId), and `ReportWorkersDuplicateSSN` (pk: ssn - one row per duplicate SSN with embedded worker details for frontend rendering). API endpoints for generation and retrieval, and frontend components for configuration, execution, and results display with CSV export.
-   **Worker Hours & Employment Views**: `worker_hours` table tracks worker hours with fields for year, month, day, worker_id, employer_id, employment_status_id, hours, and home status. Provides specialized views for current employment status, employment history, monthly aggregated hours, and daily full CRUD. API endpoints support RESTful operations with view parameters. Integrated into wizards for atomic upsert of hours with audit logging.
-   **Work Status History Auto-Sync**: The `worker_wsh` table tracks historical work status entries with automatic synchronization to `workers.denorm_ws_id`. Each time a work status history entry is created, updated, or deleted, the worker's current work status is automatically updated to reflect the most recent history entry (ordered by date DESC, then createdAt DESC). The `workerWsh` table includes a `createdAt` timestamp field to ensure proper temporal ordering when multiple entries exist on the same date. The sync logic uses robust ordering with NULLS LAST and id DESC fallback for deterministic results.
-   **Database Quickstarts**: Admin-only feature for exporting and importing complete database snapshots as JSON files. Enables rapid setup of preview/demo environments with pre-populated data. Features include: named quickstart files stored in `database/quickstarts/`, transaction-safe import with complete rollback on error, dependency-aware table ordering for foreign key integrity, schema versioning for compatibility checking, comprehensive validation to prevent corrupt data, and path traversal protection for security. Export captures all application data (excluding sessions, logs, and files) while import performs atomic replacement of all tables with the quickstart data.
-   **Cron Job System**: Complete scheduled task execution framework with registry pattern, database-backed job configuration, and node-cron scheduler. Features include: job handler registry (`server/cron/registry.ts`) for registering named handlers with type-safe execution context, bootstrap system for seeding default jobs into database, scheduler that matches database records to registered handlers and executes on schedule, admin UI with dedicated detail pages matching the application's standard layout pattern (similar to WorkerLayout). Each job has three separate routed tabs with full page reloads: View (displays latest run status and details), Settings (enable/disable toggle, manual run button with live/test mode selector), and History (complete run history table showing execution mode). The `CronJobLayout` component provides consistent header, navigation, and content structure. Cron run history displays user information (name and email) instead of UUIDs for manual runs via database joins. Supports execution modes: "live" for production runs with database changes, and "test" for dry runs that report actions without mutations. Job handlers check `context.mode` to skip database writes in test mode. The `cron_job_runs` table tracks the execution mode for each run. Includes two default jobs: `delete-expired-reports` (2 AM daily) that cleans up wizard report data based on configurable retention periods, and `delete-old-cron-logs` (3 AM daily) that removes cron job run logs older than 30 days. Initialization order ensures handlers are registered, default jobs are bootstrapped, and scheduler starts before server accepts requests. Routes: `/cron-jobs` (list view), `/cron-jobs/:name/view`, `/cron-jobs/:name/settings`, `/cron-jobs/:name/history` (separate tab pages with full page routing).

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
-   **Twilio**: Phone number lookup and validation (Twilio Lookup API).

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.
-   **@innova2/winston-pg**: Winston transport for PostgreSQL logging.

## Task Scheduling
-   **node-cron**: Task scheduling and cron job execution.

## Security
-   **DOMPurify**: HTML sanitization.