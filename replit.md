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
-   **Database Access Architecture**: All database interactions are strictly channeled through a centralized storage layer (`server/storage/`) to enforce audit logging, access control, validation, and separation of concerns.
-   **Storage Validation Framework**: Uses `createStorageValidator` and `createAsyncStorageValidator` for robust data validation.
-   **Denormalized Active Status Utility**: `calculateDenormActive` efficiently computes active status based on date ranges.
-   **Ymd Date Handling Framework**: Utilities for "date-only" fields to prevent timezone conversion issues, storing dates as `YYYY-MM-DD` strings.
-   **Worker Management**: Comprehensive CRUD operations for workers, contacts, and benefits, with server-side pagination, search, and advanced filtering.
-   **Configurable Settings**: Unified, metadata-driven options system for dynamic rendering of organizational settings forms and tables.
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts and automatic contact synchronization.
-   **Data Validation**: Extensive use of Zod schemas and `libphonenumber-js`.
-   **Employer & Policy Management**: Manages employer records, contacts, and historical policy assignments.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking functionality.
-   **Dashboard Plugin System**: Extensible architecture for customizable widgets.
-   **Components Feature Flag System**: Centralized system for managing application features with dependency and access control.
-   **Ledger System**: Manages financial transactions, accounts, payments, and integrity reports. Payment Batches feature (`ledger.payment.batch` component) provides batch grouping of payments with full CRUD, audit logging, and detail pages at `/ledger/payment-batch/:id` (Details/Edit/Payments/Logs tabs). Batches tab on account pages at `/ledger/accounts/:id/batches`. API at `/api/ledger-payment-batches`.
-   **Wizards**: Flexible workflow state management for multi-step processes.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history.
-   **Trust Eligibility Plugin System**: Registry-based architecture for worker eligibility determination.
-   **Events Management**: Full CRUD operations for events, occurrences, and scheduling.
-   **Database Quickstarts**: Admin-only feature for database snapshot export/import.
-   **System Mode**: Application-wide environment mode setting.
-   **Staff Alert Configuration & Sending System**: Reusable system for configuring and dispatching multi-media alerts.
-   **Terminology Framework**: Provides site-specific terminology customization.
-   **Dispatch System**: Manages dispatch jobs, types, listings, and detail pages. Features a plugin system to filter eligible workers based on configurable criteria using denormalized eligibility data. **Dispatch Job Groups** (`dispatch.job_group` component): Groups dispatch jobs with date ranges (`start_ymd`/`end_ymd`), optional JSON data, and full CRUD. Schema in `shared/schema/dispatch/job-group-schema.ts`, storage in `server/storage/dispatch/job-groups.ts`, API at `/api/dispatch-job-groups`. Frontend pages at `/dispatch/job_groups` (list), `/dispatch/job_group/new` (create), `/dispatch/job_group/:id` (detail with Details/Edit/Logs tabs). Layout uses `DispatchJobGroupLayout` + `useDispatchJobGroupLayout` hook. Staff-only access.
-   **Worker Bans**: Tracks worker restrictions and dynamically calculates active status.
-   **Worker Member Status History**: Tracks worker member statuses per industry over time, with `denormMsIds` on workers for quick lookup.
-   **HTA Union/Apprentice Import**: Site-specific feed wizard for importing worker data from spreadsheets, including SSN, names, work status, employer, and contact info, with validation and inactivity scans.
-   **Worker Certifications**: Manages worker certifications with automatic skill synchronization based on active certification status.
-   **EDLS (Employer Day Labor Scheduler)**: Manages day labor scheduling with sheets, crews, department-based task assignment, supervisor tracking, and audit logging. EDLS-specific worker queries are isolated to `edls-assignments` storage. Features include hierarchical rating filters and grouping available workers by member status.
-   **Web Services Framework**: Server-side API framework for exposing services to external clients, featuring bundle-based organization, client credential authentication, and optional IP allowlisting.
-   **SFTP Client Destinations**: Manages SFTP client destination configurations, including full CRUD API and UI, using a discriminated-union Zod schema for connection data. Includes a Test tab for interactive connection diagnostics (connect, list, cd, upload, download) via `server/services/file-transfer-client.ts` abstraction over `ssh2-sftp-client` and `basic-ftp`. Downloads use streaming via `stream.pipeline` (no size limit); uploads remain base64 JSON (1 MB cap).
-   **Trust Provider EDI**: Component-managed table (`trust.providers.edi`) for trust provider data interchange records, with FK reference to `sftp_client_destinations`. Full CRUD API at `/api/trust-provider-edi` (supports `?providerId=` filter). EDI tab on provider pages at `/trust/provider/{id}/edi`. EDI detail pages at `/trust/provider-edi/{id}` with Details/Edit/Logs tabs, following `SftpClientLayout` pattern (`TrustProviderEdiLayout` + `useTrustProviderEdiLayout` hook). Admin-only access.
-   **Contact Links Resolution**: Utility in `server/modules/contact-links.ts` that resolves a contactId to its canonical page URLs. `resolveContactLinks(contactId)` returns all links (worker, employer contacts, provider contacts) with labels and a `mainLink` using priority: worker > provider > employer (alphabetical within each type). `resolveContactLinksForMany(contactIds)` is a batched version for enriching lists. Exposed via `GET /api/contacts/:id/links` (auth required). Interface: `ContactLink { type, url, label, entityName }` and `ContactLinksResult { contactId, links, mainLink }`.
-   **Teamsters 631 Client Fetch**: Backend module at `server/modules/sitespecific/t631/client/fetch.ts` for communicating with the Teamsters 631 server. Core `t631Fetch(action, params?)` function handles authentication, request construction, and response parsing for all actions. Uses Basic Auth (account ID:access token) and JSON array body `[action, employerId, employerToken]`. Supported actions: `sirius_service_ping`, `sirius_edls_server_worker_list`, `sirius_dispatch_group_search`, `sirius_dispatch_facility_dropdown`, `sirius_edls_server_tos_list`. Single dispatch route at `POST /api/sitespecific/t631/client/fetch` accepts `{ action: "sirius_service_ping" }` (or any valid action from the list above). Gated by `admin` permission and both `edls` and `sitespecific.t631.client` components. Connection credentials stored as secrets (`SITESPECIFIC_T631_CLIENT_*`). Frontend test page at `/config/edls/t631-fetch` under Config > EDLS nav.
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