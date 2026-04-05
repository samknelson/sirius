# Overview

Sirius is a full-stack web application designed for comprehensive worker management. Its primary purpose is to streamline worker administration, enhance user experience, and deliver business value through efficient and reliable operations. Key capabilities include robust CRUD operations, configurable organizational settings, legal compliance reporting, benefit charge billing, and detailed worker contact management. The project aims to provide a reliable, efficient, and user-friendly platform for worker administration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend utilizes React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme to deliver a modern, accessible, and responsive user interface.

## Technical Implementations
-   **Frontend**: React 18, TypeScript, Vite, Wouter for routing, TanStack Query for server state, React Hook Form with Zod for form management. Pages are lazy-loaded.
-   **Backend**: Express.js with TypeScript, RESTful API following a feature-based module structure.
-   **Authentication**: Multi-provider authentication (Replit Auth, Okta, SAML/OAuth, Clerk, local username/password) with environment-driven configuration, multi-link account support, and PostgreSQL for session management.
-   **Masquerade Support**: Allows administrators to assume other user identities, requiring `getEffectiveUser()` for all user-specific data access.
-   **User Resolution**: Centralized user lookup via `auth_identities` with caching and active-user checks.
-   **Access Control**: Modular, entity-based policy architecture with server-side LRU caching, supporting declarative, component-defined, and modular policies, composite rules, and virtual entity support for create operations.
-   **Logging**: Winston logging with a PostgreSQL backend for audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend).
-   **Real-time Notifications**: WebSocket-based push notification system.
-   **Event Bus System**: Typed publish/subscribe event bus.
-   **Cron Job System**: Scheduled task execution framework.
-   **Migration Framework**: Versioned database migration system.

## Database Access Architecture
All database access must exclusively use a centralized storage layer (`server/storage/`) to ensure audit logging, access control, consistent validation, and potential backend interchangeability. Direct `db` imports outside this layer are prohibited. The storage layer supports transaction contexts via `runInTransaction()` and `getClient()` for atomic operations. Read-only access for reports is provided via `storage.readOnly.query()`, enforcing read-only transactions at the database level. Encapsulation violations are checked via `npx tsx scripts/dev/check-storage-encapsulation.ts`.

**Storage Validation Framework**: Reusable synchronous (`createStorageValidator`) and asynchronous (`createAsyncStorageValidator`) validators enforce data integrity, supporting `validate()` and `validateOrThrow()` methods.

**Denormalized Active Status Utility**: `calculateDenormActive` computes `denormActive` flags based on date ranges, supporting custom predicates and options for start/end date requirements.

**Ymd Date Handling Framework**: Utilities in `shared/utils/date.ts` manage "date-only" fields (`YYYY-MM-DD` string format) to prevent timezone issues. Functions include `formatYmd`, `getTodayYmd`, `compareYmd`, and `isYmdInRange`. Ymd values must not be converted to `Date` objects to avoid timezone reintroduction.

## System Design Choices
-   **Worker Management**: Comprehensive CRUD for workers, contacts, and benefits.
-   **Configurable Settings**: Unified metadata-driven options system (`/api/options/:type`) for organizational settings, dynamically rendering forms and tables via `GenericOptionsPage`.
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts and automatic contact record synchronization.
-   **Data Validation**: Extensive Zod schema validation and `libphonenumber-js`.
-   **Employer & Policy Management**: Manages employer records, contacts, and policy assignments with historical tracking.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking.
-   **Dashboard Plugin System**: Extensible architecture for customizable widgets with `fullWidth` and `requiredComponent` properties.
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control.
-   **Ledger System**: Manages financial transactions, accounts, payments, and integrity reports with entity-specific access policies.
-   **Wizards**: Flexible workflow state management for multi-step processes and report generation.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history with work status auto-sync.
-   **Trust Eligibility Plugin System**: Registry-based architecture for worker eligibility determination and benefits eligibility scans.
-   **Events Management**: Full CRUD for events, occurrences, and scheduling.
-   **Database Quickstarts**: Admin-only feature for database snapshot export/import.
-   **System Mode**: Application-wide environment mode setting (dev/test/live).
-   **Staff Alert Configuration & Sending System**: Reusable system for configuring and dispatching multi-media alerts.
-   **Terminology Framework**: Site-specific terminology customization.
-   **Dispatch System**: Manages dispatch jobs, job types, listings, and detail pages with statuses. A plugin system (`server/services/dispatch-elig-plugins/`) filters eligible workers based on configurable criteria, maintaining denormalized eligibility data for efficient querying.
-   **Worker Bans**: Tracks worker restrictions and dynamically calculates active status.
-   **Worker Member Status History**: Tracks worker member statuses per industry over time, with `denormMsIds` on workers for quick lookup.
-   **HTA Union/Apprentice Import**: Site-specific feed wizard for importing worker data from spreadsheets, including SSN, names, work status, employer, and contact info, with validation and inactivity scans.
-   **Worker Certifications**: Manages worker certifications with automatic skill synchronization based on active certification status.
-   **EDLS (Employer Day Labor Scheduler)**: Manages day labor scheduling with sheets, crews, department-based task assignment, supervisor tracking, and audit logging. EDLS-specific worker queries are isolated to `edls-assignments` storage. Features include hierarchical rating filters and grouping available workers by member status.
-   **Web Services Framework**: Server-side API framework for exposing services to external clients, featuring bundle-based organization, client credential authentication, and optional IP allowlisting.
-   **SFTP Client Destinations**: Manages SFTP client destination configurations, including full CRUD API and UI, using a discriminated-union Zod schema for connection data.

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