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
-   **Ledger System**: Manages financial transactions, accounts, payments, and integrity reports.
-   **Wizards**: Flexible workflow state management for multi-step processes.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history.
-   **Trust Eligibility Plugin System**: Registry-based architecture for worker eligibility determination.
-   **Events Management**: Full CRUD operations for events, occurrences, and scheduling.
-   **Database Quickstarts**: Admin-only feature for database snapshot export/import.
-   **System Mode**: Application-wide environment mode setting.
-   **Staff Alert Configuration & Sending System**: Reusable system for configuring and dispatching multi-media alerts.
-   **Terminology Framework**: Provides site-specific terminology customization.
-   **Dispatch System**: Manages dispatch jobs, types, listings, and detail pages. Features a plugin system to filter eligible workers based on configurable criteria using denormalized eligibility data.
-   **Worker Bans**: Tracks worker restrictions and dynamically calculates active status.
-   **Worker Member Status History**: Tracks worker member statuses per industry over time, with `denormMsIds` on workers for quick lookup.
-   **HTA Union/Apprentice Import**: Site-specific feed wizard for importing worker data from spreadsheets, including SSN, names, work status, employer, and contact info, with validation and inactivity scans.
-   **Worker Certifications**: Manages worker certifications with automatic skill synchronization based on active certification status.
-   **EDLS (Employer Day Labor Scheduler)**: Manages day labor scheduling with sheets, crews, department-based task assignment, supervisor tracking, and audit logging. EDLS-specific worker queries are isolated to `edls-assignments` storage. Features include hierarchical rating filters and grouping available workers by member status.
-   **Web Services Framework**: Server-side API framework for exposing services to external clients, featuring bundle-based organization, client credential authentication, and optional IP allowlisting.
-   **SFTP Client Destinations**: Manages SFTP client destination configurations, including full CRUD API and UI, using a discriminated-union Zod schema for connection data. Includes a Test tab for interactive connection diagnostics (connect, list, cd, upload, download) via `server/services/file-transfer-client.ts` abstraction over `ssh2-sftp-client` and `basic-ftp`. Downloads use streaming via `stream.pipeline` (no size limit); uploads remain base64 JSON (1 MB cap).
-   **Trust Provider EDI**: Component-managed table (`trust.providers.edi`) for trust provider data interchange records, with FK reference to `sftp_client_destinations`. Full CRUD API at `/api/trust-provider-edi` (supports `?providerId=` filter). EDI tab on provider pages at `/trust/provider/{id}/edi`. EDI detail pages at `/trust/provider-edi/{id}` with Details/Edit/Logs tabs, following `SftpClientLayout` pattern (`TrustProviderEdiLayout` + `useTrustProviderEdiLayout` hook). Admin-only access.
-   **Contact Links Resolution**: Utility in `server/modules/contact-links.ts` that resolves a contactId to its canonical page URLs. `resolveContactLinks(contactId)` returns all links (worker, employer contacts, provider contacts) with labels and a `mainLink` using priority: worker > provider > employer (alphabetical within each type). `resolveContactLinksForMany(contactIds)` is a batched version for enriching lists. Exposed via `GET /api/contacts/:id/links` (auth required). Interface: `ContactLink { type, url, label, entityName }` and `ContactLinksResult { contactId, links, mainLink }`.
-   **Bulk Messaging**: Infrastructure for bulk message management with medium-specific content. Main table `bulk_messages` with medium enum (email/sms/postal/inapp) and status enum (draft/queued/sent). Four medium-specific tables (`bulk_messages_email`, `bulk_messages_sms`, `bulk_messages_postal`, `bulk_messages_inapp`) with FK cascade to parent. `bulk_participants` table links messages to contacts (required, cascade delete) and optionally to comm records (set null on delete), with `status` enum (pending/send_failed/see_comm), `message` text for error details, and a JSON `data` field. Participant status tracks delivery outcome: `pending` = not yet attempted, `send_failed` = delivery attempted but no comm record created (with error in `message`), `see_comm` = comm record created (actual delivery status lives on the comm record). Six storage layers registered with audit logging. REST API at `/api/bulk-messages` with CRUD + `/message` sub-resource for medium content + `/participants` sub-resource for recipient management (GET/POST/DELETE, bypasses audit logging, uses raw storage). POST has duplicate detection (409 on existing contactId). DELETE validates participant belongs to message. `POST /api/bulk-messages/:id/deliver-test` sends a test delivery to a single contact, resolving the appropriate address for the message medium (email from contact, phone from primary number, postal from primary address, inapp via user lookup by email). `GET /api/contacts/search?q=` provides contact search by name/email (min 2 chars, limit 20), enriched with primary phone, primary address, and `mainLink` (canonical entity page URL via contact-links utility). `POST /api/bulk-messages/:id/resolve-address` previews the resolved delivery address for a contact before sending. `GET /api/bulk-messages/:id/delivery-stats` returns participant status counts (pending/sendFailed/seeComm) and comm status breakdown for see_comm participants. Delivery engine in `server/modules/bulk/deliver.ts` uses injected `IStorage` for all contact/address/phone lookups and delegates to medium-specific sender services (deliver-email.ts, deliver-sms.ts, deliver-postal.ts, deliver-inapp.ts). `deliverToParticipant` sets participant status: `see_comm` when a comm record is created (success or failure), `send_failed` when no comm could be created. Bulk deliver cron job (`bulk-deliver` in `server/cron/jobs/bulkDeliver.ts`) scans queued messages (respecting sendDate), delivers pending participants in configurable per-medium batches (emailBatchSize, smsBatchSize, postalBatchSize, inappBatchSize), gated by `bulk` component, disabled by default. List page at `/bulk/list`, detail pages at `/bulk/:id` with Details/Edit/Message/Recipients/Test/Deliver/Logs tabs (`BulkMessageLayout` + `useBulkMessageLayout` hook). Deliver tab at `/bulk/:id/deliver` shows status controls (queue/cancel/mark sent/reset) and delivery progress stats card. Test tab at `/bulk/:id/test` provides debounced contact search with entity link badges, selected contact display with resolved address preview, send test button, and result display with status/address/comm record link. Recipients tab has List and Add sub-tabs. Add sub-tab renders WorkersTable in selection mode with checkbox column, disabled rows for already-added workers, and batch add with partial-success handling. WorkersTable supports optional `selectable`, `selectedIds`, `onSelectionChange`, `disabledIds` props for checkbox selection mode. Protected by the `bulk.edit` access policy (requires `bulk` component + either `admin` or `staff.bulk` permission). Tab registry entity type `bulk_message`.

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