# Overview

Sirius is a full-stack web application for worker management, offering CRUD operations through a modern interface. It uses a React frontend with TypeScript, an Express.js backend, and PostgreSQL with Drizzle ORM for type-safe data handling. The project aims to provide a robust and user-friendly platform for efficient worker administration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI/UX**: Shadcn/ui (built on Radix UI) and Tailwind CSS with custom theming. Utilizes a "new-york" style variant.
- **State Management**: TanStack Query for server state.
- **Routing**: Wouter for client-side routing.
- **Form Handling**: React Hook Form with Zod validation.
- **Design System**: Neutral base colors and comprehensive theming support.

## Backend
- **Framework**: Express.js with TypeScript.
- **API Design**: RESTful API with structured error handling.
- **Middleware**: Custom logging middleware.
- **Development**: Vite integration for hot module replacement.
- **Authentication**: Basic session management using Connect-pg-simple for PostgreSQL session storage.

## Data Storage
- **Database**: PostgreSQL (Neon Database for serverless hosting).
- **ORM**: Drizzle ORM for type-safe operations and migrations (Drizzle Kit).
- **Schema Management**: Shared schema definitions between frontend and backend using Zod.
- **Development**: In-memory storage for testing.

## Key Features
- **Worker Management**: Full CRUD operations for workers, including detailed contact information (name components, birth date, email, phone numbers, SSN).
- **Configurable Settings**:
    - **Worker ID Types**: Management of identification number types with CRUD, sorting, and optional regex validation.
    - **Site Information**: Configurable site name displayed in the application header.
    - **Phone Number Validation**: Configurable validation modes (local via `libphonenumber-js` or real-time via Twilio Lookup API).
- **Logging**: Winston logging with PostgreSQL database backend (`@innova2/winston-pg`), capturing API requests, responses, and errors with detailed metadata.
- **Tabbed Navigation**: Workers page features tabbed navigation for list and add worker views.
- **Data Validation**: Extensive use of Zod for schema validation across the application, `libphonenumber-js` for phone numbers, and custom logic for SSN and date validation.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.

## Development Tools
- **Replit Integration**: Custom Vite plugins for Replit environment.
- **Cartographer**: Code mapping and navigation.
- **Dev Banner**: Development environment indicators.
- **Runtime Error Modal**: Enhanced error reporting.

## UI and Styling
- **Radix UI**: Accessible UI primitives.
- **Tailwind CSS**: Utility-first CSS framework.
- **Lucide React**: Icon library.
- **Class Variance Authority**: Component variant management.

## Validation and Type Safety
- **Zod**: Runtime type validation and schema definition.
- **TypeScript**: Static type checking.
- **Drizzle Zod**: Integration between Drizzle ORM and Zod.
- **libphonenumber-js**: Phone number parsing, validation, and formatting.

## Third-Party Integrations
- **Twilio**: Phone number lookup and validation (via Twilio Lookup API), managed through Replit connectors.

## API and State Management
- **TanStack Query**: Server state management.
- **Date-fns**: Date utility functions.
- **ESBuild**: JavaScript bundler.
- **@innova2/winston-pg**: Winston transport for PostgreSQL logging.