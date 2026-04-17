# Overview

Sirius is a full-stack web application designed for comprehensive worker management. It aims to streamline administrative tasks, enhance user experience, and drive business value through efficient operations. Key capabilities include robust CRUD operations, configurable organizational settings, legal compliance reporting, benefit charge billing, detailed worker contact management, and a powerful dispatch system. The project focuses on providing a reliable, efficient, and user-friendly platform for all aspects of worker administration, including a business vision to deliver significant operational efficiencies and market potential in the administrative software sector.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend utilizes React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme to ensure a modern, accessible, and responsive user experience.

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
-   **Teamsters 631 Client Fetch**: Backend module for communicating with the Teamsters 631 server, supporting actions like service ping, worker lists, dispatch group search, and facility dropdowns. Includes a cron job for syncing T631 Dispatch Job Groups into the local `dispatch_job_group` table.
-   **Facilities**: Schema-managed table for facility records, linked to contacts, with optional external `sirius_id` and raw sync payload storage (managed programmatically).
-   **Bulk Messaging**: Infrastructure for bulk message management with multi-medium support (email, SMS, postal, in-app), tracking delivery status per participant per medium.

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