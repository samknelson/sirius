# Overview

Sirius is a full-stack web application for comprehensive worker management, providing robust CRUD operations and configurable organizational settings. It aims to streamline worker administration, enhance user experience, and deliver significant business value through efficiency and reliability. The project's ambition is to provide a robust platform for managing worker data, financial transactions, and organizational policies efficiently and reliably.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend uses React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme for a modern and accessible interface. This combination ensures a consistent, responsive, and visually appealing user experience across the application.

## Technical Implementations
-   **Frontend**: Wouter for client-side routing, TanStack Query for server state management, and React Hook Form with Zod for forms.
-   **Backend**: Express.js with TypeScript, featuring a RESTful API and a feature-based module structure.
-   **Authentication**: Replit Auth (OAuth via OpenID Connect) with pre-provisioned user access and PostgreSQL-based session management.
-   **Access Control**: Centralized, declarative role-based access control with policies like `employerUser`, `workerUser`, and `admin`.
-   **Logging**: Winston logging with a PostgreSQL backend for comprehensive audit trails of CRUD operations, authentication, and wizard activities.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM for type-safe operations and migrations. Shared Zod schemas ensure consistency.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend) for persistent file storage with public/private access and signed URL generation.

## Database Access Architecture
All database queries MUST occur in the storage layer (`server/storage/`) only. This enforces strict separation of concerns where route handlers call storage functions, and storage functions query the database. This pattern applies to all modules, including logs, wizards, and other services. Each storage module exports its own `StorageLoggingConfig`, and the `database.ts` file orchestrates the `DatabaseStorage` class.

## Feature Specifications
-   **Worker Management**: Full CRUD operations for workers, including contact information, work status history, and benefits.
-   **Configurable Settings**: Manages organizational settings such as worker ID types, work statuses, and employer contact types.
-   **Employer & Policy Management**: Manages employer records, links them to contacts, and tracks policy assignments over time with date-based history and benefit configurations.
-   **Trust Provider Contacts Management**: Full CRUD operations for trust provider contacts.
-   **Ledger System**: Manages financial transactions with accounts, payments, transactions, entity-account linking, payment allocation, and an integrity report.
-   **Wizards**: Flexible workflow state management for multi-step processes, including "Feed Wizards" and a Report Wizard Framework.
-   **File Storage System**: Comprehensive file management with metadata tracking and access control.
-   **Benefits Eligibility**: A plugin-based system for determining worker eligibility for trust benefits, supporting "start" and "continue" scans, and managing `trust_wmb` records.
-   **Events Management**: Full CRUD operations for managing events, occurrences, and their scheduling.
-   **Dashboard Plugin System**: Extensible architecture for customizable dashboard widgets.
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control.
-   **System Mode**: Application-wide environment mode setting (dev/test/live) with corresponding UI indicators.
-   **Cron Job System**: A scheduled task execution framework with database-backed job configuration.
-   **Database Quickstarts**: Admin-only feature for exporting and importing complete database snapshots.

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
-   **Twilio**: Phone number lookup, validation (Twilio Lookup API), and SMS messaging with delivery status webhooks.

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.

## Task Scheduling
-   **node-cron**: Task scheduling and cron job execution.

## Security
-   **DOMPurify**: HTML sanitization.