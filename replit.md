# Overview

Sirius is a full-stack web application for comprehensive worker management. It provides robust CRUD operations, configurable organizational settings, and a modern user interface. The project aims to deliver an efficient, reliable, and user-friendly platform for worker administration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
-   **Framework**: React 18 with TypeScript and Vite.
-   **UI/UX**: Shadcn/ui (built on Radix UI) and Tailwind CSS with a "new-york" style theme.
-   **State Management**: TanStack Query for server state.
-   **Routing**: Wouter for client-side routing.
-   **Form Handling**: React Hook Form with Zod validation.

## Backend
-   **Framework**: Express.js with TypeScript.
-   **API Design**: RESTful API with structured error handling.
-   **Module Structure**: Feature-based modules in `server/modules/` for organizing related routes and logic.
-   **Authentication**: Replit Auth (OAuth via OpenID Connect) with restricted, pre-provisioned user access and PostgreSQL-based session management.
-   **Access Control**: Centralized, declarative role-based access control system.
-   **Logging**: Winston logging with a PostgreSQL database backend for storage operations and authentication events.
    -   **Storage Logging**: Comprehensive audit trail for all CRUD operations (variables, users, workers, contacts, employers, employment history, wizards, etc.) with before/after snapshots and automatic change detection. The logging middleware supports async `getEntityId` functions for generating meaningful record names and `getHostEntityId` functions for hierarchical entity tracking.
    -   **Host Entity Tracking**: The winston_logs table includes a `host_entity_id` column for tracking parent/host entities. Host entity mapping follows domain boundaries: worker-related logs (workers, worker-ids, worker-emphist) use worker ID as host; contact-related logs (contacts, addresses, phone numbers) use contact ID as host; employer-related logs (employers, employer-contacts) use employer ID as host; user-related logs (users, role assignments) use user ID as host; wizard logs use wizard entity_id as host (the associated employer or worker). Global operations (role/permission management) intentionally omit host binding.
    -   **Log Query Routes**: Entity log routes (`/api/workers/:workerId/logs`, `/api/employers/:employerId/logs`, `/api/users/:userId/logs`) use `hostEntityId` for efficient hierarchical queries instead of collecting all related entity IDs. These routes are organized in their respective domain modules (workers, employers, users).
    -   **Employment History Logging**: Worker employment history changes are logged with meaningful record names in the format "worker name :: employer name :: employment status" rather than UUIDs.
    -   **Wizard Logging**: Wizard operations (create, update, delete) are logged with descriptions in the format "wizard type display name, creation date" and host entity ID set to the wizard's entity_id (associated employer/worker).
    -   **Authentication Logging**: Tracks login, logout, masquerade start/stop events with user details and context.

## Data Storage
-   **Database**: PostgreSQL (Neon Database).
-   **ORM**: Drizzle ORM for type-safe operations and migrations.
-   **Schema Management**: Shared Zod schema definitions between frontend and backend.
-   **Storage Architecture**: Modular, namespace-based storage organized by domain (e.g., `variables`, `users`, `workers`, `employers`, `contacts`, `options`, `ledger`, `wizards`). Storage methods use simplified names (e.g., `create`, `update`, `getByName`) within their namespaces. The employerContacts storage includes a batch method `getUserAccountStatuses` for efficiently fetching user linkage status for multiple employer contacts in a single query. The contacts storage includes `getContactByEmail` for case-insensitive email lookups used in policy enforcement. The wizards storage provides CRUD operations with optional filtering by type, status, and entityId.

## Key Features
-   **Worker Management**: Full CRUD for workers, including personal and contact information, with sequential `sirius_id`.
-   **Configurable Settings**: Manages worker ID types, worker work statuses, employer contact types, site information, phone number validation, welcome messages, and dashboard plugins.
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts.
-   **Employer User Settings**: Configurable required/optional role assignments for employer users via `/config/users/employer-settings`.
-   **Data Validation**: Extensive Zod schema validation, `libphonenumber-js` for phone numbers, and custom SSN/date validation.
-   **Contact Name Handling**: Name components (title, given, middle, family) are canonicalized with capitalized first letter and lowercase remainder. Generational suffix and credentials preserve original capitalization (e.g., "III" stays "III", not "Iii").
-   **Employers**: Management of employer records with UUIDs.
-   **Employer Contacts**: Join table linking employers to contacts with optional contact type categorization (employer_contacts table). The employer contacts list displays visual indicators (badges) showing which contacts have associated user accounts.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking for workers and employers.
-   **Dashboard Plugin System**: Extensible architecture for customizable dashboard widgets, managed by admins.
-   **Components Feature Flag System**: Manages enablement of application features (components) via a centralized registry, with dependency management and integration with access control policies.
-   **Access Control**: Centralized permission registry and declarative policies for fine-grained control over features and data. The `employerUser` policy grants employer users access to their associated employer records by requiring the "employer" permission and either "staff" permission or verified association via an employer-contact record matching the user's email. The `workerUser` policy grants worker users access to their associated worker records by requiring the "worker" permission and either "staff" permission or verified association via matching contact email. All administrative functions (user management, component configuration, address validation) use the unified `admin` policy.
-   **Routing Architecture**: Consistent routing patterns for configuration pages (under `/config/`) and detail pages, with UUID validation and legacy redirects.
-   **Ledger System**: Manages financial transactions with a `ledger_payments` table, including status, allocation, payer details, and account references.
-   **Wizards**: Flexible workflow state management system for tracking multi-step processes (imports, bulk operations, etc.) with JSON data storage, type/status filtering, current step tracking, and full audit logging via Winston. The wizards table includes a `current_step` field that stores the step ID of the wizard's current position; if not set during creation, it defaults to the first step from the wizard type's steps() method.
    -   **Wizard Type System**: Modular architecture in `server/wizards/` with BaseWizard abstraction providing shared utilities (step navigation, status transitions, data validation). FeedWizard extends base for data generation workflows with CSV/JSON serialization, date range handling, and output formatting.
    -   **Wizard Registry**: Centralized registry manages wizard type registration and discovery. Routes expose `/api/wizard-types` for listing types, `/api/wizard-types/:type/steps` for type-specific steps, and `/api/wizard-types/:type/statuses` for available statuses. Create/update operations validate wizard type against registry.
    -   **Feed Wizards**: Two GBHET feed implementations - `gbhet_legal_workers_monthly` for monthly worker data exports and `gbhet_legal_workers_corrections` for generating correction feeds with custom step definitions.
    -   **Wizard UI Integration**: Employer detail pages include a "Wizards" tab (`/employers/:id/wizards`) for managing employer-scoped wizards. The wizard detail view (`/wizards/:id`) displays current step with visual highlighting in the steps list, shows step badge in the details card, and allows status updates.

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