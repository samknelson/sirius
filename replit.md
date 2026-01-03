# Overview

Sirius is a full-stack web application designed for comprehensive worker management. Its primary purpose is to streamline worker administration, enhance user experience, and deliver significant business value through efficient and reliable operations. Key capabilities include robust CRUD operations, configurable organizational settings, advanced features for legal compliance reporting, benefit charge billing, and detailed worker contact management.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend uses React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme for a modern, accessible, and responsive interface.

## Technical Implementations
-   **Frontend**: Wouter for routing, TanStack Query for server state, React Hook Form with Zod for forms. Pages are lazy-loaded.
-   **Backend**: Express.js with TypeScript, RESTful API, and a feature-based module structure.
-   **Authentication**: Replit Auth (OAuth via OpenID Connect) with PostgreSQL-based session management.
-   **Masquerade Support**: Admins can masquerade as other users. Backend endpoints that access user-specific data MUST use `getEffectiveUser()` from `server/modules/masquerade.ts` to get the correct user context (masqueraded or original). Pattern:
    ```typescript
    const user = (req as any).user;
    const replitUserId = user?.claims?.sub;
    const session = req.session as any;
    const { dbUser } = await getEffectiveUser(session, replitUserId);
    ```
-   **Access Control**: Modular policy architecture with entity-based access policies and server-side LRU caching. Components can define their own permissions and policies via `ComponentDefinition`, which are automatically registered when the component is enabled. Policy references allow composite rules (e.g., `staff OR (permission AND another-policy)`) with cycle detection.
    -   **Modular Policy Architecture**: All 21 core policies are defined as individual files under `shared/access-policies/` with custom `evaluate` functions receiving a `PolicyContext`. Modular policies are checked first; declarative policies serve as fallback for component-defined policies. File paths mirror policy IDs (e.g., `worker.dispatch.dnc.view` → `dispatch/dnc/view.ts`). Policies are loaded via `shared/access-policies/loader.ts` at server startup.
    -   **PolicyContext**: Injected utilities for policy handlers: `hasPermission()`, `loadEntity()`, `checkPolicy()`, `isComponentEnabled()`, `getUserContact()`, `getUserWorker()`.
    -   **Virtual Entity Support**: For create operations (no entityId yet), pass `entityData` to policies. For updates, merge existing entity with proposed changes before evaluation.
    -   **Recursion Protection**: Policy delegation tracks evaluation stack to prevent infinite loops when policies reference each other.
-   **Logging**: Winston logging with a PostgreSQL backend for audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend) for persistent file storage.
-   **Real-time Notifications**: WebSocket-based push notification system.
-   **Event Bus System**: Typed publish/subscribe event bus for domain and audit events.
-   **Cron Job System**: Scheduled task execution framework with database-backed configuration.
-   **Migration Framework**: Versioned database migration system.

## System Design Choices
-   **Database Access Architecture**: All database queries are strictly confined to the storage layer, ensuring separation of concerns.
-   **Worker Management**: Comprehensive CRUD for workers, contacts, and benefits.
-   **Configurable Settings**: Manages organizational settings (worker ID types, work statuses, employer contact types).
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts, with automatic contact record synchronization.
-   **Data Validation**: Extensive Zod schema validation and `libphonenumber-js`.
-   **Employer & Policy Management**: Manages employer records, contacts, and policy assignments with historical tracking.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking.
-   **Dashboard Plugin System**: Extensible architecture for customizable widgets.
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control, cached in memory.
-   **Ledger System**: Manages financial transactions including accounts, payments, and integrity reports. EA (Entity Account) access uses `ledger.ea.view` and `ledger.ea.edit` policies that delegate to entity-specific policies (`employer.ledger`, `worker.ledger`, `provider.ledger`) based on the EA's entity type. Staff-only admin pages (payment routes, payment types config, accounts list) use `ledger.staff` policy.
-   **Wizards**: Flexible workflow state management for multi-step processes and report generation.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history, with auto-sync for work status.
-   **Trust Eligibility Plugin System**: Registry-based architecture for worker eligibility determination (e.g., Work Status, GBHET Legal), including benefits eligibility scans.
-   **Events Management**: Full CRUD for events, occurrences, and scheduling.
-   **Database Quickstarts**: Admin-only feature for database snapshot export/import.
-   **System Mode**: Application-wide environment mode setting (dev/test/live).
-   **Staff Alert Configuration & Sending System**: Reusable system for configuring and dispatching multi-media alerts (SMS, Email, In-App) based on context, with user contact synchronization.
-   **Terminology Framework**: Site-specific terminology customization for concepts like "Shop Steward", with admin configuration and client-side consumption.
-   **Dispatch System**: Conditional feature for managing dispatch jobs, including job types, listings, and detail pages with various statuses and eligibility plugins (worker bans, do not call, hold for employer, work status).
-   **Worker Bans**: Tracks worker restrictions with start/end dates and ban types, dynamically calculating active status.

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