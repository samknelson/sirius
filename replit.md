# Overview

Sirius is a full-stack web application for worker management, offering robust CRUD operations through a modern, user-friendly interface. It leverages a React frontend with TypeScript, an Express.js backend, and PostgreSQL with Drizzle ORM for type-safe data handling. The project's core purpose is to provide an efficient and reliable platform for comprehensive worker administration and configurable organizational settings.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI/UX**: Shadcn/ui (built on Radix UI) and Tailwind CSS with custom "new-york" style theming.
- **State Management**: TanStack Query for server state.
- **Routing**: Wouter for client-side routing.
- **Form Handling**: React Hook Form with Zod validation.

## Backend
- **Framework**: Express.js with TypeScript.
- **API Design**: RESTful API with structured error handling.
- **Authentication**: Replit Auth (OAuth via OpenID Connect) with restricted, pre-provisioned user access. Session management uses Connect-pg-simple for PostgreSQL storage.
- **Access Control**: Centralized, declarative access control system with role-based permissions and policy definitions.
- **Logging**: Winston logging with PostgreSQL database backend (`@innova2/winston-pg`) for detailed API and error logs.

## Data Storage
- **Database**: PostgreSQL (Neon Database for serverless hosting).
- **ORM**: Drizzle ORM for type-safe operations and migrations.
- **Schema Management**: Shared Zod schema definitions between frontend and backend.

## Key Features
- **Worker Management**: Full CRUD for workers, including detailed personal and contact information. Includes a sequential `sirius_id` for human-readable identifiers.
- **Configurable Settings**:
    - **Worker ID Types**: CRUD for various identification number types with sorting and optional regex validation.
    - **Site Information**: Configurable site name.
    - **Phone Number Validation**: Configurable validation via `libphonenumber-js` or Twilio Lookup API.
    - **Welcome Messages**: Role-specific dashboard welcome messages with HTML formatting (sanitized with DOMPurify).
- **User Provisioning**: Email-based user provisioning workflow, linking Replit accounts upon first login.
- **Data Validation**: Extensive Zod schema validation across the application, `libphonenumber-js` for phone numbers, and custom SSN/date validation.
- **Employers**: Employer management with auto-generated UUIDs for identification.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.

## UI and Styling
- **Radix UI**: Accessible UI primitives.
- **Tailwind CSS**: Utility-first CSS framework.
- **Lucide React**: Icon library.

## Validation and Type Safety
- **Zod**: Runtime type validation and schema definition.
- **TypeScript**: Static type checking.
- **Drizzle Zod**: Integration for Drizzle ORM and Zod.
- **libphonenumber-js**: Phone number parsing, validation, and formatting.

## Third-Party Integrations
- **Twilio**: Phone number lookup and validation (via Twilio Lookup API).

## API and State Management
- **TanStack Query**: Server state management.
- **Date-fns**: Date utility functions.
- **@innova2/winston-pg**: Winston transport for PostgreSQL logging.

## Security
- **DOMPurify**: HTML sanitization for user-generated content.