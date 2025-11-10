# Overview

Sirius is a full-stack web application for comprehensive worker management. It provides robust CRUD operations, configurable organizational settings, and a modern user interface. The project aims to deliver an efficient, reliable, and user-friendly platform for worker administration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
-   **Framework**: React 18 with TypeScript and Vite.
-   **UI/UX**: Shadcn/ui (built on Radix UI) and Tailwind CSS with a "new-york" style theme.
-   **State Management**: TanStack Query for server state.
-   **Routing**: Wouter for client-side routing.
-   **Form Handling**: React Hook Form with Zod validation.

## Backend
-   **Framework**: Express.js with TypeScript.
-   **API Design**: RESTful API with structured error handling.
-   **Module Structure**: Feature-based modules in `server/modules/` for organizing related routes and logic.
-   **Authentication**: Replit Auth (OAuth via OpenID Connect) with restricted, pre-provisioned user access and PostgreSQL-based session management.
-   **Access Control**: Centralized, declarative role-based access control system.
-   **Logging**: Winston logging with a PostgreSQL database backend for storage operations and authentication events.
    -   **Storage Logging**: Comprehensive audit trail for all CRUD operations (variables, users, workers, contacts, employers, etc.) with before/after snapshots and automatic change detection.
    -   **Authentication Logging**: Tracks login, logout, masquerade start/stop events with user details and context.

## Data Storage
-   **Database**: PostgreSQL (Neon Database).
-   **ORM**: Drizzle ORM for type-safe operations and migrations.
-   **Schema Management**: Shared Zod schema definitions between frontend and backend.
-   **Storage Architecture**: Modular, namespace-based storage organized by domain (e.g., `variables`, `users`, `workers`, `employers`, `contacts`, `options`, `ledger`). Storage methods use simplified names (e.g., `create`, `update`, `getByName`) within their namespaces. The employerContacts storage includes a batch method `getUserAccountStatuses` for efficiently fetching user linkage status for multiple employer contacts in a single query.

## Key Features
-   **Worker Management**: Full CRUD for workers, including personal and contact information, with sequential `sirius_id`.
-   **Configurable Settings**: Manages worker ID types, employer contact types, site information, phone number validation, welcome messages, and dashboard plugins.
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts.
-   **Employer User Settings**: Configurable required/optional role assignments for employer users via `/config/users/employer-settings`.
-   **Data Validation**: Extensive Zod schema validation, `libphonenumber-js` for phone numbers, and custom SSN/date validation.
-   **Contact Name Handling**: Name components (title, given, middle, family) are canonicalized with capitalized first letter and lowercase remainder. Generational suffix and credentials preserve original capitalization (e.g., "III" stays "III", not "Iii").
-   **Employers**: Management of employer records with UUIDs.
-   **Employer Contacts**: Join table linking employers to contacts with optional contact type categorization (employer_contacts table). The employer contacts list displays visual indicators (badges) showing which contacts have associated user accounts.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking for workers and employers.
-   **Dashboard Plugin System**: Extensible architecture for customizable dashboard widgets, managed by admins.
-   **Components Feature Flag System**: Manages enablement of application features (components) via a centralized registry, with dependency management and integration with access control policies.
-   **Access Control**: Centralized permission registry and declarative policies for fine-grained control over features and data.
-   **Routing Architecture**: Consistent routing patterns for configuration pages (under `/config/`) and detail pages, with UUID validation and legacy redirects.
-   **Ledger System**: Manages financial transactions with a `ledger_payments` table, including status, allocation, payer details, and account references.

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
-   **Twilio**: Phone number lookup and validation (Twilio Lookup API).

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.
-   **@innova2/winston-pg**: Winston transport for PostgreSQL logging.

## Security
-   **DOMPurify**: HTML sanitization.