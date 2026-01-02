# Overview

Sirius is a full-stack web application for comprehensive worker management. It provides robust CRUD operations and configurable organizational settings to streamline worker administration, enhance user experience, and deliver significant business value through efficiency and reliability. The system includes advanced features for legal compliance reporting, benefit charge billing, and detailed worker contact management.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend utilizes React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme for a modern and accessible interface. This combination ensures a consistent, responsive, and visually appealing user experience across the application.

## Technical Implementations
-   **Frontend**: Wouter for routing, TanStack Query for server state, React Hook Form with Zod for forms. Pages are lazy-loaded using `React.lazy()` with Suspense to optimize initial load time.
-   **Backend**: Express.js with TypeScript, RESTful API, and a feature-based module structure.
-   **Authentication**: Replit Auth (OAuth via OpenID Connect) with PostgreSQL-based session management.
-   **Access Control**: Centralized, declarative role-based access control.
-   **Logging**: Winston logging with a PostgreSQL backend for audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend) for persistent file storage.

## Database Access Architecture
All database queries are strictly confined to the storage layer (`server/storage/`). Route handlers and services must utilize storage functions and never directly access the `db` object. This enforces strict separation of concerns where route handlers call storage functions, and storage functions query the database.

## Feature Specifications
-   **Worker Management**: Full CRUD operations for workers, including contact information, work status history, and benefits.
-   **Configurable Settings**: Manages organizational settings (worker ID types, work statuses, employer contact types).
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts.
-   **Data Validation**: Extensive Zod schema validation, `libphonenumber-js` for phone numbers, and custom validations.
-   **Employer & Policy Management**: Manages employer records, links them to contacts, and tracks policy assignments over time with date-based history and benefit configurations.
-   **Trust Provider Contacts Management**: Full CRUD operations for trust provider contacts.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking.
-   **Dashboard Plugin System**: Extensible architecture for customizable dashboard widgets, including "My Steward" plugin that displays stewards assigned to the current user's home employer and bargaining unit with contact details (name, email, phone).
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control. Component enabled states are stored in a single `components` JSON variable (not individual per-component variables) and cached in memory at startup. The cache is invalidated only on enable/disable operations, eliminating per-request database queries.
-   **Routing Architecture**: Consistent routing for configuration, detail pages, and reports.
-   **Ledger System**: Manages financial transactions with accounts, payments, transactions, entity-account linking, payment allocation, and an integrity report.
-   **Wizards**: Flexible workflow state management for multi-step processes, including "Feed Wizards" and a Report Wizard Framework.
-   **File Storage System**: Comprehensive file management with metadata tracking and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history.
-   **Work Status History Auto-Sync**: Automatically synchronizes worker's current work status.
-   **Policy Benefits Configuration**: Allows admins to select Trust Benefits offered by each policy.
-   **Trust Eligibility Plugin System**: Registry-based plugin architecture for worker eligibility determination (e.g., Work Status, GBHET Legal).
-   **Benefits Eligibility Scan**: Worker-level scan to evaluate policy benefits for a given month/year, supporting "start" and "continue" scans, and managing `trust_wmb` records.
-   **Events Management**: Full CRUD operations for managing events, occurrences, and their scheduling.
-   **Database Quickstarts**: Admin-only feature for exporting and importing complete database snapshots.
-   **Cron Job System**: Scheduled task execution framework with database-backed job configuration.
-   **System Mode**: Application-wide environment mode setting (dev/test/live) with corresponding UI indicators.
-   **Migration Framework**: Versioned database migration system in `/scripts/migrate/`. Migrations are registered in `scripts/migrate/index.ts`, run at startup via `server/services/migration-runner.ts`, and tracked with a `migrations_version` variable. New migrations use numbered filenames (e.g., `002_feature_name.ts`) and implement `Migration` interface with `name`, `version`, and `run()` function.
-   **Real-time Notifications**: WebSocket-based push notification system for in-app alerts. Server: `notifyAlertCountChange(userId)` exported from `server/modules/comm.ts` broadcasts alert count changes to specific users. Client: `useWebSocket()` hook provides `isConnected` and `alertCount` with automatic reconnection (max 5 attempts) and graceful fallback to 30-second polling when disconnected.
-   **Staff Alert Configuration System**: Reusable system for configuring alert recipients with multi-media support (SMS, Email, In-App). Storage function `getUsersWithAnyPermission()` fetches users by permission. Module `server/modules/staff-alerts.ts` provides GET/PUT `/api/staff-alerts/:context` endpoints with server-side user ID validation. Configuration stored in variables with namespacing pattern `staff_alert:{context}`. Controlled component `StaffAlertConfigEditor` accepts value/onChange props for flexible integration. First implementation: `staff_alert:trust_wmb_scan` for WMB scan completion alerts.
-   **Alert Sending System**: Portable alert dispatcher (`server/services/alert-dispatcher.ts`) that sends SMS, email, and in-app notifications based on staff alert configuration. Uses `sendStaffAlerts(context, payload, storage)` to load config from variables, resolve user contacts via email matching, and dispatch via Twilio (SMS), SendGrid (email), and in-app sender. Message payloads are typed in `shared/staffAlertMessages.ts` with per-context message composing functions. In-app sender (`server/services/inapp-sender.ts`) creates alerts and triggers WebSocket push notifications via `notifyAlertCountChange()`. Integrated into WMB scan completion flow - alerts are sent asynchronously via `setImmediate()` after scan status changes to 'complete'.
-   **User-Contact Auto-Sync**: When users are created or updated, a corresponding contact record is automatically created or updated. Service `server/services/user-contact-sync.ts` provides `ensureContactForUser()` which is called by user storage methods (createUser, updateUser, upsertUser, linkReplitAccount). This ensures all users have contact records for the alert system, with email matching via case-insensitive lookup. Contact fields populated: email, given (from firstName), family (from lastName), displayName (synthesized).
-   **User Contact & Communication Management**: User account pages (`/users/:id`) include Contact and Comm tab groups that reuse existing Worker/Employer/Provider contact components. Pages include: email display, phone numbers (PhoneNumberManagement), addresses (AddressManagement), communication history (CommList), and send SMS/Email/Postal (CommSms, CommEmail, CommPostal). Contact records are fetched via email matching using `GET /api/contacts/by-email/:email`. The frontend gracefully handles users without contact records by returning null on 404.
-   **Event Bus System**: Typed publish/subscribe event bus (`server/services/event-bus.ts`) for domain events. Supports event types: HOURS_SAVED, PAYMENT_SAVED, WMB_SAVED, PARTICIPANT_SAVED, CRON, LOG. Storage layers emit events after persistence. Charge plugins and other modules subscribe to react to business operations.
-   **LOG Event System**: Audit trail events emitted when logs are persisted via the custom `LogsTransport` Winston transport. The transport writes through logs storage (`server/storage/logs.ts`) which emits `EventType.LOG` events. Log notifier module (`server/modules/log-notifier.ts`) subscribes to LOG events with guard rails to prevent recursive alert storms (ignores events from "log-notifier", "alert-dispatcher", "inapp-sender" sources). LOG events represent audit records distinct from domain events - notifications can consume either based on whether they care about business operations or the audit trail.
-   **Terminology Framework**: Site-specific terminology customization allowing organizations to rename concepts like "Shop Steward" to alternatives (e.g., "Building Rep", "Union Rep"). Architecture: `shared/terminology.ts` defines the terminology registry with default terms and resolver function; `server/modules/terminology.ts` provides GET/PUT/RESET API endpoints storing custom terms in the `site_terminology` variable; `client/src/contexts/TerminologyContext.tsx` provides React context and hooks (`useTerminology`, `useTerm`) for consuming terms. The `useTerm` hook returns a resolver function: `term("steward")` returns singular form, `term("steward", { plural: true })` returns plural, `term("steward", { lowercase: true })` returns lowercase. Admin configuration available at `/config/terminology` with live preview and reset-to-defaults functionality. Currently supports the "steward" term; framework designed for easy expansion to additional terms.
-   **Dispatch System**: Conditional feature (controlled by "dispatch" component) for managing dispatch jobs. Tables defined in `shared/schema/dispatch/schema.ts` and created when component is enabled. Includes job types configuration, job listing with pagination/filtering (employer, status, job type, date range), and detail/edit pages. Job statuses: draft, open, running, closed, archived. Storage layer in `server/storage/dispatch-jobs.ts` with `getPaginated()` supporting conditional where clauses.
-   **Worker Bans**: Tracks worker restrictions with start/end dates and ban types (dispatch, event). Active status is calculated dynamically based on date comparison. API uses `z.coerce.date()` for ISO string to Date conversion. Validation ensures end_date cannot precede start_date and start_date must be today or earlier. Storage in `server/storage/worker-bans.ts` with event bus integration (WORKER_BAN_SAVED events). UI at `/workers/:id/bans`.
-   **Dispatch Eligibility Plugin System**: Registry-based plugin architecture (`server/services/dispatch-elig-plugin-registry.ts`) for determining worker eligibility for dispatch jobs. Plugins declare eligibility conditions (exists, not_exists, exists_or_none, not_exists_category) that are combined into SQL WHERE clauses. Plugins subscribe to domain events to recompute eligibility data stored in `worker_dispatch_elig_denorm` table. Current plugins: dispatch_ban (worker bans), dispatch_dnc (do not call), dispatch_hfe (hold for employer), dispatch_status (work status). The ban plugin creates per-ban eligibility entries (value: `dispatch:{banId}`) with calendar-day date comparisons via `isBanCurrentlyActive()`. Expired ban eligibility is swept by the `sweep-expired-ban-elig` cron job (daily at 5 AM). The `sync-ban-active-status` cron job (daily at 6 AM) synchronizes the `active` field on worker_bans based on expiration dates: bans with expired endDate are set to active=false, bans with no endDate or future endDate are set to active=true.

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
-   **Twilio**: Phone number lookup, validation (Twilio Lookup API), and SMS messaging with delivery status webhooks.

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.

## Task Scheduling
-   **node-cron**: Task scheduling and cron job execution.

## Security
-   **DOMPurify**: HTML sanitization.
