# Overview

Sirius is a full-stack web application designed for comprehensive worker management. Its primary purpose is to provide an efficient, reliable, and user-friendly platform with robust CRUD operations and configurable organizational settings. The project aims to offer a modern solution for worker administration, delivering significant business value through streamlined operations and an enhanced user experience.

# Recent Changes (November 14, 2025)

## Report Wizard Framework
-   **Custom Reporting System**: Implemented extensible report wizard framework for worker data analysis, integrated with existing wizard infrastructure
-   **WizardReport Base Class** (server/wizards/report.ts): Three-step workflow (Inputs → Run → Results) with abstract methods for column definitions and record fetching. Supports batch processing with progress tracking
-   **Report Data Storage**: Per-worker row storage in `wizard_report_data` table with unique constraint on `(wizard_id, pk)` where `pk` is the worker's UUID. Each report result gets its own database row for granular querying and efficient updates.
    -   Added `pk` column (varchar NOT NULL) to support per-worker storage
    -   Unique index on `(wizard_id, pk)` prevents duplicate worker entries
    -   Re-run support: `deleteReportData()` removes old report data before generating new results
    -   Zero-record handling: Metadata row (empty pk) persisted when no workers match report criteria
-   **Storage Methods**: Extended WizardStorage with `saveReportData(wizardId, pk, data)`, `getReportData(wizardId)`, `getLatestReportData(wizardId)`, and `deleteReportData(wizardId)` for complete report lifecycle management
-   **Concrete Implementations**: 
    -   `ReportWorkersMissingSSN`: Finds workers with null/empty SSN using efficient database JOINs (workers LEFT JOIN contacts), includes workers.id as workerId
    -   `ReportWorkersInvalidSSN`: Finds workers with invalid SSN format using database JOINs and validateSSN(), includes workers.id as workerId
-   **API Endpoints**: 
    -   POST /api/wizards/:id/generate-report - Triggers report generation, saves individual worker rows, returns aggregated results
    -   GET /api/wizards/:id/report-data - Retrieves all report rows and reconstructs full ReportResults structure
-   **Frontend Components**:
    -   InputsStep: Report configuration UI (extensible for future parameters)
    -   RunStep: Report generation trigger with real-time progress polling via useQuery refetchInterval
    -   ResultsStep: Table display of results with CSV export functionality using default apiRequest fetcher
-   **Reports Page** (/reports): Lists report wizard types, shows recent reports with status, dialog for creating new reports with admin-only access
-   **Navigation**: Added "Reports" link to Header navigation (admin policy required)
-   **Step Registry Integration**: Registered report step components with completion evaluators (evaluateRunComplete checks wizard.data.progress.run.status)
-   **Performance Optimization**: Report fetchers use database JOINs instead of serial per-record lookups to avoid O(n²) performance issues. Single query reconstruction in getReportResults() maintains frontend compatibility while enabling per-worker persistence.

# Recent Changes (November 14, 2025)

## Worker Hours & Employment Views Reorganization
-   **New Table**: Added `worker_hours` table with fields for year, month, day, worker_id, employer_id, employment_status_id, hours, and home. Includes unique constraint on (worker, employer, year, month, day) and cascade deletes for worker and employer foreign keys.
-   **Storage Methods**: Extended WorkerStorage interface with complete CRUD operations including `createWorkerHours`, `updateWorkerHours`, `deleteWorkerHours`, and `upsertWorkerHours` (used by wizards, defaults day=1) using atomic upsert with full audit logging. Added three specialized view methods:
    -   `getCurrentEmploymentStatus`: Shows most recent hours entry per employer with status and home field (using DISTINCT ON)
    -   `getEmploymentHistory`: Shows month/year when employment status or home status changed per employer (using window functions for change detection)
    -   `getMonthlyHours`: Shows aggregated hours by month per employer with home status aggregation using bool_or/bool_and (allHome: all entries were home, anyHome: at least one entry was home)
-   **API Endpoints**: Added RESTful endpoints for worker hours management (GET, POST, PATCH, DELETE) with proper authentication and authorization. GET endpoint now accepts a `view` query parameter (current, history, monthly, daily) to return different data structures. POST and PATCH endpoints require year, month, and day fields, and accept optional home boolean field (defaults to false).
-   **Day Field Validation**: Schema validation ensures day is 1-31 and validates against actual days in month (handles leap years, 30/31-day months). Frontend dynamically shows valid day options based on selected year/month.
-   **Home Field**: Boolean field indicating whether work was performed from home. Displayed across all four Employment tabs:
    -   **Current**: Shows home status as badge (Home/On-site) for most recent entry per employer
    -   **History**: Shows home status as badge (Home/On-site) for each status change event
    -   **Monthly**: Shows aggregated home status as badge (All Home/Some Home/All On-site) based on whether all, some, or none of the days in the month were home
    -   **Daily**: Full CRUD with Switch component in Add/Edit forms and badge display in table
-   **Frontend**: Reorganized worker employment tracking into four specialized sub-tabs under the Employment section:
    -   **Current**: Displays current employment status and home status per employer (no hours shown)
    -   **History**: Shows employment status and home status change timeline (most recent first)
    -   **Monthly**: Shows aggregated hours and home status by month per employer
    -   **Daily**: Full CRUD interface for individual hours entries with year/month/day inputs and home toggle. Multiple records allowed per worker/employer/month with different days.
-   **Security**: All endpoints require authentication; GET endpoint requires worker policy access, mutations require workers.manage permission.
-   **Wizard Integration**: GbhetLegalWorkersWizard (monthly and corrections) now processes worker hours during the Process step. Hours are upserted atomically with employment status validation, year/month coercion, and row-level error handling for partial successes.
-   **Logging Middleware Enhancement**: Updated logging middleware to pass `beforeState` to `after()` callbacks, enabling all storage methods to properly distinguish create vs update operations in audit metadata.
-   **Employment History Removal**: Completely removed `worker_emphist` table and all employment history tracking functionality. Worker hours tracking with 4 specialized views is now the single source for employment data.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend utilizes React 18 with TypeScript and Vite, employing Shadcn/ui (built on Radix UI) and Tailwind CSS with a "new-york" style theme for a modern and accessible user interface.

## Technical Implementations
-   **Frontend**: Wouter for client-side routing, TanStack Query for server state management, and React Hook Form with Zod for form handling and validation.
-   **Backend**: Express.js with TypeScript, featuring a RESTful API with structured error handling and a feature-based module structure.
-   **Authentication**: Replit Auth (OAuth via OpenID Connect) with restricted, pre-provisioned user access and PostgreSQL-based session management.
-   **Access Control**: A centralized, declarative role-based access control system. Policies like `employerUser` and `workerUser` grant entity-specific access, while `admin` policy governs administrative functions.
-   **Logging**: Winston logging with a PostgreSQL backend provides a comprehensive audit trail for all CRUD operations, authentication events, and wizard activities, including before/after snapshots and host entity tracking for hierarchical queries.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM for type-safe operations and migrations. Shared Zod schemas ensure consistency between frontend and backend. Modular, namespace-based storage organizes data by domain.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend) is used for persistent file storage, offering public/private access, signed URL generation, and a 50MB upload limit.

## Feature Specifications
-   **Worker Management**: Full CRUD for workers with sequential `sirius_id`.
-   **Configurable Settings**: Manages various organizational settings such as worker ID types, work statuses, employer contact types, and dashboard plugins.
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts.
-   **Data Validation**: Extensive Zod schema validation, `libphonenumber-js` for phone numbers, and custom SSN/date validation. Contact names are canonicalized.
-   **Employer & Contact Management**: Management of employer records with UUIDs and the ability to link employers to contacts with type categorization and visual indicators for user accounts.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking for workers and employers.
-   **Dashboard Plugin System**: Extensible architecture for customizable dashboard widgets with unified settings framework.
    -   **Unified Settings Storage**: All plugin settings are stored in a single JSON variable per plugin (`dashboard_plugin_{pluginId}_settings`) instead of plugin-specific endpoints and variables.
    -   **Generic Settings API**: Plugins use unified GET/PUT `/api/dashboard-plugins/:pluginId/settings` endpoints with automatic migration from legacy variables, schema validation via Zod, and RBAC enforcement.
    -   **Plugin Metadata**: Shared metadata file (`shared/pluginMetadata.ts`) defines schema validation and permission requirements for each plugin, ensuring consistency between client and server.
    -   **Settings Components**: Plugins can declare optional `settingsComponent` in the registry, loaded via the dynamic route `/config/dashboard-plugins/:pluginId`, with generic `loadSettings`/`saveSettings` functions for reusable settings management.
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control integration.
-   **Routing Architecture**: Consistent routing patterns for configuration and detail pages, including UUID validation and legacy redirects.
-   **Ledger System**: Manages financial transactions with a `ledger_payments` table.
-   **Wizards**: A flexible workflow state management system for multi-step processes (e.g., imports, bulk operations). It supports type-specific steps, status transitions, data validation, and full audit logging.
    -   **Feed Wizards**: Specialized wizards for data generation workflows with CSV/JSON serialization, file upload/parsing, and configurable field definitions. They include advanced features like batch processing with real-time validation progress via Server-Sent Events (SSE) and dynamic field requirements based on 'create' or 'update' modes.
    -   **Step Completion Validation**: Robust validation ensures that each wizard step is completed and valid before allowing progression, enforced both on the frontend and backend.
    -   **Mapping Preferences**: User-specific column mapping preferences are saved to the `wizard_feed_mappings` table, indexed by user, wizard type, and a hash of the header row. When a user uploads a file with a similar structure, the previously saved mapping is automatically suggested, streamlining the workflow for repeat operations.
    -   **Launch Constraints**: Type-specific validation rules enforce business logic when creating wizards. Legal workers monthly wizards are limited to one per employer/month/year, while corrections wizards require a completed monthly wizard as a prerequisite. Three-layer protection (pre-flight validation, transaction re-validation, HttpError handling) prevents race conditions and ensures data integrity. Backwards compatible with legacy status values ('complete' and 'completed').
    -   **Report Data Storage**: The `wizard_report_data` table stores report outputs generated by wizards. Each wizard can have multiple report data entries with temporal ordering via `created_at` timestamp, enabling deterministic retrieval of the latest report. This provides clean separation between wizard state (stored in `wizards.data`) and wizard-generated report outputs.
-   **File Storage System**: Comprehensive file management with metadata tracking, access control policies (entity-based and permission-based), and RESTful API endpoints for upload, download, and management, utilizing Replit's object storage service for signed URL generation and operations.

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

## Security
-   **DOMPurify**: HTML sanitization.