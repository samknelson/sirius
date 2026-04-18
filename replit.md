# Overview

Sirius is a comprehensive full-stack web application designed for efficient worker management. Its primary goal is to streamline administrative tasks, improve user experience, and deliver significant business value through features like robust CRUD operations, configurable organizational settings, legal compliance reporting, benefit charge billing, detailed worker contact management, and an advanced dispatch system. The project aims to provide a reliable, efficient, and user-friendly platform for all aspects of worker administration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is built with React 18, TypeScript, Vite, Shadcn/ui (based on Radix UI), and Tailwind CSS with a "new-york" theme, ensuring a modern, accessible, and responsive user interface.

## Technical Implementations
-   **Frontend**: React 18, TypeScript, Vite, Wouter for routing, TanStack Query for server state management, and React Hook Form with Zod for form validation. Pages are lazy-loaded for performance.
-   **Backend**: Express.js with TypeScript, providing a RESTful API structured with feature-based modules.
-   **Authentication**: Supports multi-provider authentication (Replit Auth, Okta, SAML/OAuth, Clerk, local username/password) with environment-driven configuration and masquerade capabilities.
-   **Access Control**: Implements a modular, entity-based policy architecture with server-side LRU caching.
-   **Logging**: Winston logging is integrated with a PostgreSQL backend to maintain audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) is managed using Drizzle ORM.
-   **Object Storage**: Utilizes Replit Object Storage, backed by Google Cloud Storage.
-   **Real-time Notifications**: Features a WebSocket-based push notification system.
-   **Event Bus System**: A typed publish/subscribe event bus facilitates inter-service communication.
-   **Cron Job System**: Provides a framework for scheduling periodic tasks.
-   **Migration Framework**: Manages database schema changes with a versioned migration system.

## System Design Choices
-   **Database Access Architecture**: All database interactions are centralized through a storage layer for audit logging, access control, validation, and separation of concerns.
-   **Data Validation**: Utilizes Zod schemas and `libphonenumber-js` for robust data validation.
-   **Worker Management**: Comprehensive CRUD operations for workers, contacts, and benefits, with server-side pagination, search, and advanced filtering.
-   **Configurable Settings**: A unified, metadata-driven options system supports dynamic form and table rendering.
-   **User Provisioning**: Email-based provisioning integrated with Replit accounts and automatic contact synchronization.
-   **Employer & Policy Management**: Manages employer records, contacts, and historical policy assignments.
-   **Bookmarks**: Provides user-specific, entity-agnostic bookmarking functionality.
-   **Dashboard Plugin System**: An extensible architecture allows for customizable widgets.
-   **Components Feature Flag System**: A centralized system for managing application features, including dependencies and access control.
-   **Ledger System**: Manages financial transactions, accounts, payments, and integrity reports, including payment batches.
-   **Wizards**: Offers flexible workflow state management for multi-step processes.
-   **File Storage System**: Comprehensive file management with metadata and access control.
-   **Worker Hours & Employment Views**: Tracks worker hours and employment history.
-   **Trust Eligibility Plugin System**: A registry-based architecture determines worker eligibility.
-   **Events Management**: Full CRUD for events, occurrences, and scheduling.
-   **Dispatch System**: Manages dispatch jobs, types, listings, and detail pages, including a plugin system for worker eligibility filtering. Supports Dispatch Job Groups for grouping jobs with date ranges and external system linkage.
-   **Worker Bans**: Tracks worker restrictions and dynamically calculates active status.
-   **Worker Member Status History**: Tracks worker member statuses per industry over time.
-   **Worker Certifications**: Manages worker certifications with automatic skill synchronization.
-   **EDLS (Employer Day Labor Scheduler)**: Manages day labor scheduling with sheets, crews, department-based task assignment, supervisor tracking, and audit logging.
-   **Web Services Framework**: A server-side API framework for exposing services to external clients with client credential authentication and optional IP allowlisting.
-   **SFTP Client Destinations**: Manages SFTP client configurations with CRUD API and UI, including connection diagnostics.
-   **Trust Provider EDI**: Manages trust provider data interchange records with SFTP client destination integration.
-   **Bulk Messaging**: Infrastructure for bulk message management with multi-medium support (email, SMS, postal, in-app).

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
-   **Drizzle Zod**: Integration between Drizzle ORM and Zod.
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