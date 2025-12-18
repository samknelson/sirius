# Overview

Sirius is a full-stack web application for comprehensive worker management. It provides robust CRUD operations and configurable organizational settings to streamline worker administration, enhance user experience, and deliver significant business value through efficiency and reliability. The system includes advanced features for legal compliance reporting, benefit charge billing, and detailed worker contact management.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend utilizes React 18 with TypeScript, Vite, Shadcn/ui (built on Radix UI), and Tailwind CSS with a "new-york" theme for a modern and accessible interface. This combination ensures a consistent, responsive, and visually appealing user experience across the application.

## Technical Implementations
-   **Frontend**: Wouter for routing, TanStack Query for server state, React Hook Form with Zod for forms.
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
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control.
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
