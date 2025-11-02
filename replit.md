# Overview

Sirius is a full-stack web application built for worker management. It provides a clean, modern interface for managing workers with CRUD (Create, Read, Update, Delete) operations. The application features a React frontend with TypeScript, an Express.js backend, and uses PostgreSQL as the database with Drizzle ORM for type-safe database operations.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite as the build tool
- **UI Components**: Shadcn/ui component library built on top of Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation
- **Design System**: Uses a "new-york" style variant with neutral base colors and comprehensive theming support

## Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful API with proper HTTP status codes and error handling
- **Middleware**: Custom logging middleware for API requests and responses
- **Development Tools**: Vite integration for hot module replacement in development
- **Error Handling**: Centralized error handling middleware with proper status codes

## Data Storage Solutions
- **Database**: PostgreSQL with Neon Database as the serverless provider
- **ORM**: Drizzle ORM for type-safe database operations and migrations
- **Schema Management**: Shared schema definitions between frontend and backend using Zod for validation
- **Migrations**: Drizzle Kit for database schema migrations
- **Development Storage**: In-memory storage implementation for development/testing

## Authentication and Authorization
- **Session Management**: Connect-pg-simple for PostgreSQL session storage
- **Current Implementation**: Basic session setup (authentication logic not fully implemented)

## External Dependencies

### Database Services
- **Neon Database**: Serverless PostgreSQL hosting
- **Environment**: Requires `DATABASE_URL` environment variable

### Development Tools
- **Replit Integration**: Custom Vite plugins for Replit development environment
- **Cartographer**: Code mapping and navigation
- **Dev Banner**: Development environment indicators
- **Runtime Error Modal**: Enhanced error reporting during development

### UI and Styling
- **Radix UI**: Comprehensive set of accessible UI primitives
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide React**: Icon library
- **Class Variance Authority**: Utility for managing component variants

### Validation and Type Safety
- **Zod**: Runtime type validation and schema definition
- **TypeScript**: Static type checking across the entire application
- **Drizzle Zod**: Integration between Drizzle ORM and Zod validation
- **libphonenumber-js**: Phone number parsing, validation, and formatting

### Third-Party Integrations
- **Twilio**: Phone number lookup and validation via Twilio Lookup API
  - Managed through Replit connectors for secure credential management
  - Provides carrier information, caller name, and line type intelligence

### API and State Management
- **TanStack Query**: Server state management with caching and synchronization
- **Date-fns**: Date utility functions
- **ESBuild**: Fast JavaScript bundler for production builds

## Recent Changes

### Contact Name Components (November 2, 2025)
- **Name Structure**: Contact names now use structured components instead of a single field
  - Components: title, given (first), middle, family (last), generational (Jr., Sr., III), credentials (MD, PhD)
  - Display name is generated from components and used throughout the UX
  - Backend automatically parses simple names into given/family components
  - Helper function `generateDisplayName()` in shared schema formats names consistently
- **Worker-Contact Relationship**: Workers reference contacts, contact names displayed via displayName field
  - Workers table removed name field, now uses contact relationship exclusively
  - All worker views fetch and display contact displayName
  - "Name" tab added to worker detail pages for editing contact name
  - Edit functionality updates contact name components and regenerates displayName
- **Database Migration**: Existing contact names migrated to new structure
  - Old "name" field split into given/family components
  - displayName populated from original names
  - All frontend code updated to use displayName

### Phone Number Management (November 2, 2025)
- **Phone Number Validation**: All phone numbers are validated and stored in E.164 format
  - Backend validation service uses libphonenumber-js to parse and validate phone numbers
  - Invalid phone numbers are rejected with clear error messages
  - Phone numbers are automatically canonicalized to E.164 format before storage
- **Display Formatting**: Phone numbers are displayed in U.S. national format for better readability
  - List view shows formatted phone numbers (e.g., (555) 123-4567)
  - Edit dialog pre-fills with formatted phone numbers
  - Internal storage remains in E.164 format for consistency and international compatibility
- **Frontend Validation**: Client-side validation provides immediate feedback to users
  - Zod schema validation prevents submission of invalid phone numbers
  - Clear error messages guide users to correct format
- **Validation Modes**: Configurable phone validation with local or Twilio options
  - Configuration page at `/config/phone-numbers` allows switching between validation modes
  - Local mode: Pattern-based validation using libphonenumber-js (no API calls)
  - Twilio mode: Real-time validation using Twilio Lookup API with carrier and caller name data
  - Fallback mechanism: Can fall back to local validation if Twilio API fails
  - Lookup fields are configurable (carrier, caller-name, line type intelligence)
  - Configuration changes take effect immediately without requiring server restart
  - Full validation response data stored in JSONB field for auditing

### Worker SSN Management (November 2, 2025)
- **SSN Field**: Workers table now includes an SSN (Social Security Number) field
  - Stored as unformatted 9-digit string (e.g., "008621234")
  - Displayed in formatted XXX-XX-XXXX format (e.g., "008-62-1234")
  - Helper functions `formatSSN()` and `unformatSSN()` in shared schema handle formatting
- **IDs Tab**: New "IDs" tab added to worker detail pages for managing identification numbers
  - Displays current SSN with formatted display
  - Edit mode provides validation and auto-formatting as user types
  - Backend validation ensures SSN is exactly 9 digits
  - SSN field is optional and can be cleared
- **Navigation**: All worker detail pages now include "IDs" tab alongside Details, Name, Addresses, and Phone Numbers
  - Route: `/workers/:id/ids`
  - IDsManagement component handles viewing and editing SSN
  - Backend API: PUT `/api/workers/:id` with `ssn` field updates worker SSN