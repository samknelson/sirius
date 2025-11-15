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
-   **Routing Architecture**: Consistent routing patterns for configuration and detail pages.
-   **Ledger System**: Manages financial transactions using a `ledger_payments` table.
-   **Wizards**: Flexible workflow state management for multi-step processes, supporting type-specific steps, status transitions, data validation, and audit logging. Includes specialized "Feed Wizards" for data generation with CSV/JSON serialization, batch processing, and user-specific column mapping preferences. Features robust step completion validation and launch constraints to ensure data integrity and prevent race conditions. Report outputs are stored in `wizard_report_data` for clear separation from wizard state.
-   **File Storage System**: Comprehensive file management with metadata tracking, access control, and RESTful API endpoints.
-   **Report Wizard Framework**: Extensible framework for worker data analysis, featuring a three-step workflow (Inputs → Run → Results) and dual storage architecture for report metadata and worker-specific results. Supports re-run functionality and includes concrete implementations like `ReportWorkersMissingSSN` and `ReportWorkersInvalidSSN`. API endpoints for generation and retrieval, and frontend components for configuration, execution, and results display with CSV export.
-   **Worker Hours & Employment Views**: `worker_hours` table tracks worker hours with fields for year, month, day, worker_id, employer_id, employment_status_id, hours, and home status. Provides specialized views for current employment status, employment history, monthly aggregated hours, and daily full CRUD. API endpoints support RESTful operations with view parameters. Integrated into wizards for atomic upsert of hours with audit logging.

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