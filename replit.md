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

### Workers Page Tab Navigation (November 2, 2025)
- **Separate Routes**: Workers page now has two separate tabs with distinct routes
  - `/workers` - List view showing all workers in a table
  - `/workers/add` - Add worker form for creating new workers
- **Tab Navigation**: Both pages have tab navigation that allows switching between List and Add views
- **Full Page Refresh**: Clicking tabs triggers full page navigation (not client-side only)
- **Redirect After Add**: Successfully adding a worker redirects to the list view
- **Permission**: Add page requires `workers.manage` permission while list requires `workers.view`

### Site Information Configuration (November 2, 2025)
- **Site Name Setting**: New configuration page at `/config/site` for managing site name
  - Replaces hardcoded "Sirius" in header with configurable site name
  - Uses existing variables table to store site name
  - API endpoints: GET and PUT `/api/site-settings`
- **Header Update**: Main header now fetches and displays site name from settings
  - Falls back to "Sirius" if no custom name is set
- **Configuration Navigation**: Site Information added to configuration sidebar
  - Requires `variables.manage` permission
  - Each configuration section now has proper permission filtering in sidebar

### Worker Page Icon Update (November 2, 2025)
- **Person Icon**: Replaced star icon with person icon in worker detail page headers
  - Applied to all worker pages (Details, Name, Email, IDs, Addresses, Phone Numbers)
  - Provides better visual indication that these pages are for individual workers

## Recent Changes (Prior)

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

### Contact Email Management (November 2, 2025)
- **Email Field**: Contacts table now includes an email address field
  - Stored as text in the database
  - Validated using standard email format regex (basic validation)
  - Email field is optional and can be left empty
- **Email Tab**: New "Email" tab added to worker detail pages for managing email addresses
  - Displays current email address with Mail icon
  - Edit mode provides validation before saving
  - Backend and frontend both validate email format
  - Clear error messages for invalid email formats
- **Details Display**: Email address now appears on the main worker Details page
  - Shown in the Contact Information section
  - Displayed alongside phone number and address
  - Shows "No email address set" if not configured
- **Navigation**: All worker detail pages now include "Email" tab alongside Details, Name, IDs, Addresses, and Phone Numbers
  - Route: `/workers/:id/email`
  - EmailManagement component handles viewing and editing email
  - Backend API: PUT `/api/workers/:id` with `email` field updates contact email

### Worker SSN Management (November 2, 2025)
- **SSN Field**: Workers table now includes an SSN (Social Security Number) field
  - Stored as unformatted 9-digit string (e.g., "008621234")
  - Displayed in formatted XXX-XX-XXXX format (e.g., "008-62-1234")
  - Helper functions `formatSSN()`, `unformatSSN()`, and `validateSSN()` in shared schema handle formatting and validation
  - SSN field has a unique constraint - no two workers can have the same SSN
  - Duplicate SSN attempts return a 409 Conflict error with a clear message
- **SSN Validation**: SSNs are validated against standard Social Security Administration rules
  - Cannot begin with 000 (invalid area number)
  - Cannot begin with 666 (never assigned)
  - Cannot begin with 900-999 (reserved for specific purposes)
  - Middle two digits cannot be 00 (invalid group number)
  - Last four digits cannot be 0000 (invalid serial number)
  - Both frontend and backend validate against these rules with clear error messages
- **IDs Tab**: New "IDs" tab added to worker detail pages for managing identification numbers
  - Displays current SSN with formatted display
  - Edit mode provides validation and auto-formatting as user types
  - Backend validation ensures SSN follows all standard rules
  - SSN field is optional and can be cleared
  - Shows error message if trying to use an SSN already assigned to another worker or if SSN violates standard rules
- **Navigation**: All worker detail pages now include "IDs" tab alongside Details, Name, Addresses, and Phone Numbers
  - Route: `/workers/:id/ids`
  - IDsManagement component handles viewing and editing SSN
  - Backend API: PUT `/api/workers/:id` with `ssn` field updates worker SSN