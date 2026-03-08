# Overview

Sirius is a full-stack web application designed for comprehensive worker management. Its primary purpose is to streamline worker administration, enhance user experience, and deliver business value through efficient and reliable operations. Key capabilities include robust CRUD operations, configurable organizational settings, legal compliance reporting, benefit charge billing, detailed worker contact management, and a powerful dispatch system. The project aims to provide a reliable, efficient, and user-friendly platform for all aspects of worker administration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend utilizes React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme, ensuring a modern, accessible, and responsive user experience.

## Technical Implementations
-   **Frontend**: Wouter for routing, TanStack Query for server state management, and React Hook Form with Zod for robust form handling. Pages are lazy-loaded for optimized performance.
-   **Backend**: Express.js with TypeScript, implementing a RESTful API with a feature-based module structure.
-   **Authentication**: Supports multi-provider authentication (Replit Auth, Okta, SAML/OAuth, local username/password) with environment-driven configuration. Includes masquerade support for administrators and a centralized user resolution mechanism.
-   **Access Control**: Modular, entity-based policy architecture with server-side LRU caching for efficient access management. **Note:** When adding new employer tabs, consider whether shop stewards should have view-only access and use `policyId: 'employer.steward.view'` instead of `permission: 'staff'` for view-only tabs.
-   **Logging**: Winston logging integrated with a PostgreSQL backend for comprehensive audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend) for persistent file storage.
-   **Real-time Notifications**: WebSocket-based push notification system.
-   **Event Bus System**: Typed publish/subscribe event bus for inter-service communication.
-   **Cron Job System**: Framework for scheduling and executing periodic tasks.
-   **Migration Framework**: Versioned database migration system.

## System Design Choices
-   **Database Access Architecture**: All database interactions are strictly channeled through a centralized storage layer (`server/storage/`) to enforce audit logging, access control, validation, and maintain a clear separation of concerns. Read-only access for reports is provided via `storage.readOnly.query()`.
-   **Storage Validation Framework**: Utilizes `createStorageValidator` and `createAsyncStorageValidator` for reusable, robust data validation.
-   **Denormalized Active Status Utility**: `calculateDenormActive` efficiently computes active status based on date ranges for various entities.
-   **Ymd Date Handling Framework**: Dedicated utilities for "date-only" fields to prevent timezone conversion issues, storing dates as `YYYY-MM-DD` strings.
-   **Worker Management**: Comprehensive CRUD operations for workers, contacts, and benefits, featuring server-side pagination, apply-on-demand search (with Search button and Enter key), and advanced filtering. Worker search is consolidated into a single internal `_searchWorkers()` function in `server/storage/workers.ts` that is component-aware (conditionally joins `bargaining_units` and `trust_wmb`/`trust_benefits` tables only when their respective components are enabled). Search supports name, email, phone, SSN, and worker IDs configured to show on lists (`showOnLists` flag). Sorting supports last name, first name, and employer fields with asc/desc direction.
-   **Configurable Settings**: A unified, metadata-driven options system allows dynamic rendering of organizational settings forms and tables via a single frontend component (`GenericOptionsPage`).
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts and automatic contact synchronization.
-   **Data Validation**: Extensive use of Zod schemas and `libphonenumber-js` for robust data integrity.
-   **Employer & Policy Management**: Manages employer records, contacts, and historical policy assignments.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking functionality.
-   **Dashboard Plugin System**: Extensible architecture for customizable widgets.
-   **Components Feature Flag System**: Centralized system for managing application features with dependency and access control.
-   **Ledger System**: Manages financial transactions, accounts, payments, and integrity reports with entity-specific access policies.
-   **Wizards**: Flexible workflow state management for multi-step processes and report generation.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history with automated work status synchronization.
-   **Trust Eligibility Plugin System**: Registry-based architecture for worker eligibility determination and benefits scans.
-   **Events Management**: Full CRUD operations for events, occurrences, and scheduling.
-   **Database Quickstarts**: Admin-only feature for database snapshot export/import.
-   **System Mode**: Application-wide environment mode setting (dev/test/live).
-   **Staff Alert Configuration & Sending System**: Reusable system for configuring and dispatching multi-media alerts.
-   **Terminology Framework**: Provides site-specific terminology customization.
-   **Dispatch System**: Manages dispatch jobs, types, listings, and detail pages. Features a plugin system to filter eligible workers based on configurable criteria (bans, skills, work status, etc.) using denormalized eligibility data for efficiency.
-   **Worker Bans**: Tracks worker restrictions and dynamically calculates active status.
-   **Worker Member Status History**: Tracks worker member statuses per industry over time, with denormalized IDs for quick lookup. Includes an automated member status scan system (`server/services/member-status-scan.ts`) that determines Non-member/Pending/Member/Delinquent status based on card check and dues payment history. Per-BU delinquent-days threshold configured via `bargainingUnit.data.memberStatusDelinquentDays` (default 60). Runs daily at 7 AM via cron, after dues imports, and via manual rescan.
-   **Worker Certifications**: Manages worker certifications, automatically syncing skills based on active certification status.
-   **EDLS (Employer Day Labor Scheduler)**: Manages day labor scheduling, including sheets, crews, task assignment, supervisor tracking, and audit logging. Incorporates specialized worker queries for EDLS context and advanced filtering with rating statistics.
-   **Web Services Framework**: Server-side API framework for exposing services to external clients, supporting bundle-based organization, client credential authentication, and optional IP allowlisting.
-   **Card Check Revocation Roles**: Configurable per card check definition via `revokeRoles` array in the definition's `data` JSON field. Controls which roles can revoke a signed card check (`staff` always allowed, `worker` opt-in). Enforced on both frontend (button visibility) and backend (403 on PATCH). Defaults to staff-only when not configured.
-   **Card Check Signature Import**: Wizard-based tool for importing offline signatures from ZIP files, matching workers, and creating electronic signature records.
-   **Card Check Scraper Import**: Automated wizard that scrapes signed card checks from an external Drupal site (sirius-btu.activistcentral.net), generates/combines PDFs using puppeteer-core and pdf-lib, matches workers by BPS Employee ID, and creates card check + e-signature records. Skips workers who already have upload-type e-signatures. Stores the external Drupal NID (`sourceNid`) on card check records to prevent duplicate imports on re-runs, enforced by a partial unique index.
-   **BTU Building Rep Import**: Wizard for importing building representatives from a fixed-format CSV file (Name, ID/Badge #, Phone, Email). Matches workers by BPS Employee ID, determines current employer from worker_hours employment records, and creates steward assignments (worker_steward_assignments table). Features a 4-step flow: Upload > Preview > Process > Results, with clear reporting of matched, unmatched, already-assigned, and error rows.
-   **Steward Bulk Remove**: The steward list page (`/stewards`) supports checkbox selection with select-all and a bulk remove operation. Removals go through the individual `deleteAssignment` storage method which triggers per-record audit logging to each affected worker's record. Includes confirmation dialog and partial-failure reporting.
-   **Worker ID Show on Lists**: Configurable worker ID types can be displayed as dynamic columns on worker lists and reports.
-   **Organizing Missing Dues BU Filter**: Configurable setting in the OEL Status Groups dialog that controls which bargaining units are included in potential missing dues calculations. Stored as `organizing_dues_bu_ids` variable. Applied to both the OEL `distinctMissingDuesRevenue` and the BU Summary dashboard plugin `totalMissingDuesRevenue`. Empty selection means all BUs are included.
-   **BTU Territories**: Manages geographical territory assignments for BTU-specific features, linking territories to employers and workers.

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