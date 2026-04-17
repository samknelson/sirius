# Overview

Sirius is a full-stack web application for comprehensive worker management. Its purpose is to streamline administration, enhance user experience, and deliver business value through efficient operations. Key capabilities include robust CRUD operations, configurable organizational settings, legal compliance reporting, benefit charge billing, detailed worker contact management, and a powerful dispatch system. The project aims to provide a reliable, efficient, and user-friendly platform for all aspects of worker administration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend uses React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme, ensuring a modern, accessible, and responsive user experience.

## Technical Implementations
-   **Frontend**: React 18, TypeScript, Vite, Wouter for routing, TanStack Query for server state management, and React Hook Form with Zod for form handling. Pages are lazy-loaded.
-   **Backend**: Express.js with TypeScript, implementing a RESTful API with a feature-based module structure.
-   **Authentication**: Supports multi-provider authentication (Replit Auth, Okta, SAML/OAuth, Clerk, local username/password) with environment-driven configuration and masquerade support.
-   **Access Control**: Modular, entity-based policy architecture with server-side LRU caching.
-   **Logging**: Winston logging integrated with a PostgreSQL backend for audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend).
-   **Real-time Notifications**: WebSocket-based push notification system.
-   **Event Bus System**: Typed publish/subscribe event bus.
-   **Cron Job System**: Framework for scheduling periodic tasks.
-   **Migration Framework**: Versioned database migration system.

## System Design Choices
-   **Database Access Architecture**: All database interactions are channeled through a centralized storage layer to enforce audit logging, access control, validation, and separation of concerns.
-   **Data Validation**: Robust validation using Zod schemas and `libphonenumber-js`.
-   **Worker Management**: Comprehensive CRUD for workers, contacts, and benefits, with server-side pagination, search, and advanced filtering.
-   **Configurable Settings**: Unified, metadata-driven options system for dynamic form and table rendering.
-   **User Provisioning**: Email-based provisioning integrated with Replit accounts and automatic contact synchronization.
-   **Employer & Policy Management**: Manages employer records, contacts, and historical policy assignments.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking.
-   **Dashboard Plugin System**: Extensible architecture for customizable widgets.
-   **Components Feature Flag System**: Centralized system for managing application features with dependency and access control.
-   **Ledger System**: Manages financial transactions, accounts, payments, and integrity reports, including payment batches.
-   **Wizards**: Flexible workflow state management for multi-step processes.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history.
-   **Trust Eligibility Plugin System**: Registry-based architecture for worker eligibility determination.
-   **Events Management**: Full CRUD for events, occurrences, and scheduling.
-   **Database Quickstarts**: Admin-only feature for database snapshot export/import.
-   **System Mode**: Application-wide environment mode setting.
-   **Staff Alert Configuration & Sending System**: Reusable system for configuring and dispatching multi-media alerts.
-   **Terminology Framework**: Provides site-specific terminology customization.
-   **Dispatch System**: Manages dispatch jobs, types, listings, and detail pages, featuring a plugin system for worker eligibility filtering. Includes Dispatch Job Groups for grouping jobs with date ranges and external system linkage, with data managed programmatically by backend sync processes.
-   **Worker Bans**: Tracks worker restrictions and dynamically calculates active status.
-   **Worker Member Status History**: Tracks worker member statuses per industry over time.
-   **HTA Union/Apprentice Import**: Site-specific feed wizard for importing worker data from spreadsheets.
-   **Worker Certifications**: Manages worker certifications with automatic skill synchronization.
-   **EDLS (Employer Day Labor Scheduler)**: Manages day labor scheduling with sheets, crews, department-based task assignment, supervisor tracking, and audit logging.
-   **Web Services Framework**: Server-side API framework for exposing services to external clients with client credential authentication and optional IP allowlisting.
-   **SFTP Client Destinations**: Manages SFTP client configurations with CRUD API and UI, including connection diagnostics.
-   **Trust Provider EDI**: Manages trust provider data interchange records with SFTP client destination integration.
-   **Contact Links Resolution**: Utility to resolve a `contactId` to its canonical page URLs across different entity types (worker, employer, provider contacts).
-   **Teamsters 631 Client Fetch**: Backend module for communicating with the Teamsters 631 server, supporting actions like service ping, worker lists, dispatch group search, and facility dropdowns. Includes a cron job for syncing T631 Dispatch Job Groups into the local `dispatch_job_group` table, and a separate `sitespecific-t631-facility-fetch` cron job (daily, disabled by default, gated by the `sitespecific.t631.client` component) that pulls `sirius_dispatch_facility_dropdown` and reconciles each `{siriusId, name}` entry against the local `facilities` table via `syncFacilities` in `server/modules/sitespecific/t631/client/sync-facilities.ts`. The facility sync uses only existing `FacilityStorage` methods (`getBySiriusId`, `create`, `updateContactName`), processes one row at a time, never deletes locally-only rows, never writes the `data` jsonb (the feed only carries a name), and skips the write entirely when the local name already matches — so re-runs are idempotent and don't generate audit-log churn.
-   **Facilities** (`facility` component): Each facility owns a `contacts` row (FK `contacts_id`, ON DELETE RESTRICT) and the facility's name is stored on that contact; renaming the facility goes through `storage.facilities.updateContactName` so contact and facility stay in sync. Optional unique `sirius_id` and `data` jsonb are populated programmatically by sync processes (never via the UI). REST API at `/api/facilities` (`server/modules/facility/facilities.ts`) uses `facility.view` (authenticated) for list/detail and `facility.edit` (staff) for create/update; PATCH accepts `{name?, nameComponents?, email?}` and delegates name + email to the contacts storage. Detail UI lives at `/facility/:id` with tabs Details / Edit / Contact (parent of Email, Addresses, Phone Numbers) / Logs, declared in `shared/tabRegistry.ts`'s `facilityTabTree` and rendered by `FacilityLayout`. Contact sub-tabs reuse the shared `EntityEmailManagement`, `AddressManagement`, and `PhoneNumberManagement` components against `facility.contactId`; the address/phone GET routes in `server/modules/contact-postal.ts` and `server/modules/phone-numbers.ts` recognize facility-owned contacts and gate read access with `facility.view` so non-staff can view but not modify. Logs are served through the shared `/api/logs/by-entity` endpoint, which now resolves worker / facility / employer entities and aggregates the parent id with its associated contact id(s) so contact-side activity (email/address/phone/name changes) shows up alongside the parent entity's own audit trail.
-   **Bulk Messaging**: Infrastructure for bulk message management with multi-medium support. Main table `bulk_messages` with `medium` as `text[]` array (email/sms/postal/inapp) and status enum (draft/queued/sent). A single bulk message campaign can target multiple channels simultaneously. Four medium-specific content tables (`bulk_messages_email`, `bulk_messages_sms`, `bulk_messages_postal`, `bulk_messages_inapp`) with FK cascade to parent. `bulk_participants` table links messages to contacts with a `medium` varchar column indicating the delivery channel; unique constraint on `(messageId, contactId, medium)` allows one participant row per contact per medium. Participant `status` enum (pending/send_failed/see_comm) tracks delivery outcome per medium. POST participants fans out one row per medium in the message's medium array (returns `{created, skipped}`). GET `/message` without `?medium` returns `{media, records}` dict of all medium content; with `?medium=` returns single medium. PUT `/message?medium=` saves content for a specific medium. PATCH updates use add/remove logic for medium-specific content tables when the medium array changes. `delivery-stats` returns `byMedium` breakdown alongside totals. `resolve-address` and `deliver-test` accept `medium` in request body (defaults to first medium). Delivery engine in `server/modules/bulk/deliver.ts` uses `resolveAddressForMedium(storage, medium, contactId)` and `deliverToParticipant` reads `participant.medium`. Cron job (`bulkDeliver.ts`) uses per-participant medium for batch sizing. Frontend: create/edit pages use checkbox multi-select for media; Message tab shows sub-tabs per selected medium; Recipients list includes Medium column; Test tab has medium selector dropdown; Deliver tab shows per-medium progress stats. Protected by the `bulk.edit` access policy (requires `bulk` component + either `admin` or `staff.bulk` permission). Tab registry entity type `bulk_message`.

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

## File Transfer
-   **ssh2-sftp-client**: SFTP client library.
-   **basic-ftp**: FTP client library.

## Third-Party Integrations
-   **Twilio**: Phone number lookup, validation, and SMS messaging.

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.

## Task Scheduling
-   **node-cron**: Task scheduling and cron job execution.

## Security
-   **DOMPurify**: HTML sanitization.