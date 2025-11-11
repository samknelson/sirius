# Overview

Sirius is a full-stack web application designed for comprehensive worker management. Its primary purpose is to provide an efficient, reliable, and user-friendly platform with robust CRUD operations and configurable organizational settings. The project aims to offer a modern solution for worker administration, delivering significant business value through streamlined operations and an enhanced user experience.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend utilizes React 18 with TypeScript and Vite, employing Shadcn/ui (built on Radix UI) and Tailwind CSS with a "new-york" style theme for a modern and accessible user interface.

## Technical Implementations
-   **Frontend**: Wouter for client-side routing, TanStack Query for server state management, and React Hook Form with Zod for form handling and validation.
-   **Backend**: Express.js with TypeScript, featuring a RESTful API with structured error handling and a feature-based module structure.
-   **Authentication**: Replit Auth (OAuth via OpenID Connect) with restricted, pre-provisioned user access and PostgreSQL-based session management.
-   **Access Control**: A centralized, declarative role-based access control system. Policies like `employerUser` and `workerUser` grant entity-specific access, while `admin` policy governs administrative functions.
-   **Logging**: Winston logging with a PostgreSQL backend provides a comprehensive audit trail for all CRUD operations, authentication events, and wizard activities, including before/after snapshots and host entity tracking for hierarchical queries.
-   **Data Storage**: PostgreSQL (Neon Database) managed with Drizzle ORM for type-safe operations and migrations. Shared Zod schemas ensure consistency between frontend and backend. Modular, namespace-based storage organizes data by domain.
-   **Object Storage**: Replit Object Storage (Google Cloud Storage backend) is used for persistent file storage, offering public/private access, signed URL generation, and a 50MB upload limit.

## Feature Specifications
-   **Worker Management**: Full CRUD for workers with sequential `sirius_id`.
-   **Configurable Settings**: Manages various organizational settings such as worker ID types, work statuses, employer contact types, and dashboard plugins.
-   **User Provisioning**: Email-based user provisioning integrated with Replit accounts.
-   **Data Validation**: Extensive Zod schema validation, `libphonenumber-js` for phone numbers, and custom SSN/date validation. Contact names are canonicalized.
-   **Employer & Contact Management**: Management of employer records with UUIDs and the ability to link employers to contacts with type categorization and visual indicators for user accounts.
-   **Bookmarks**: User-specific, entity-agnostic bookmarking for workers and employers.
-   **Dashboard Plugin System**: Extensible architecture for customizable dashboard widgets.
-   **Components Feature Flag System**: Centralized registry for managing application features with dependency management and access control integration.
-   **Routing Architecture**: Consistent routing patterns for configuration and detail pages, including UUID validation and legacy redirects.
-   **Ledger System**: Manages financial transactions with a `ledger_payments` table.
-   **Wizards**: A flexible workflow state management system for multi-step processes (e.g., imports, bulk operations). It supports type-specific steps, status transitions, data validation, and full audit logging.
    -   **Feed Wizards**: Specialized wizards for data generation workflows with CSV/JSON serialization, file upload/parsing, and configurable field definitions. They include advanced features like batch processing with real-time validation progress via Server-Sent Events (SSE) and dynamic field requirements based on 'create' or 'update' modes.
    -   **Step Completion Validation**: Robust validation ensures that each wizard step is completed and valid before allowing progression, enforced both on the frontend and backend.
    -   **Mapping Preferences**: User-specific column mapping preferences are saved to the `wizard_feed_mappings` table, indexed by user, wizard type, and a hash of the header row. When a user uploads a file with a similar structure, the previously saved mapping is automatically suggested, streamlining the workflow for repeat operations.
-   **File Storage System**: Comprehensive file management with metadata tracking, access control policies (entity-based and permission-based), and RESTful API endpoints for upload, download, and management, utilizing Replit's object storage service for signed URL generation and operations.

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