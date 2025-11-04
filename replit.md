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
- **Authentication**: Replit Auth (OAuth via OpenID Connect) with restricted access - users must be pre-created by admins. Session management using Connect-pg-simple for PostgreSQL session storage.

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

# Recent Changes

## Centralized Access Control System (November 4, 2025)
- **Architecture Overhaul**: Replaced hardcoded `requireAuth`/`requirePermission` middleware with centralized access control module
  - **Core Components**:
    - **Access Control Module** (`server/accessControl.ts`): Core system with TypeScript interfaces and evaluators
    - **Policy Registry** (`server/policies.ts`): Declarative access policies for all routes
    - **Context Builder**: Extracts request information (user, route, params, body) for access decisions
    - **Policy Evaluator**: Runs access checks with support for simple and complex requirements
  - **Access Policy Types**:
    - `authenticated`: Requires user to be logged in
    - `permission`: Requires specific permission key
    - `anyPermission`: Requires any one of multiple permissions
    - `allPermissions`: Requires all specified permissions
    - `ownership`: Resource ownership checks (for future implementation)
    - `anyOf`/`allOf`: Logical composition of requirements
    - `custom`: Custom async validation functions
  - **Admin Bypass**: Users with "admin" permission automatically pass all access checks
  - **Predefined Policies**: Common policies exported from `server/policies.ts`:
    - `adminManage`: Admin management operations
    - `workersView`/`workersManage`: Worker access levels
    - `employersView`/`employersManage`: Employer access levels
    - `variablesView`/`variablesManage`: Configuration access
    - `benefitsView`/`benefitsManage`: Benefits management
  - **Route Migration**: Example routes migrated to new system (marked with "MIGRATED" comments)
    - User management: GET/POST/PUT `/api/admin/users`
    - Role management: GET/POST `/api/admin/roles`
  - **Usage Pattern**: Routes now use `requireAccess(policies.policyName)` instead of multiple middleware
  - **Backward Compatibility**: Old `requireAuth` and `requirePermission` functions available as wrappers around new system
  - **Benefits**: 
    - Centralized access logic for easier maintenance
    - Type-safe policy definitions
    - Support for complex access rules with logical composition
    - Easy to test policies independently
    - Automatic admin override on all routes

## Email-Based User Provisioning (November 4, 2025)
- **User Provisioning Workflow**: Users are now provisioned by email instead of Replit ID
  - **How it works**: 
    1. Admin provisions user by entering their email address (and optionally name)
    2. User record is created with `accountStatus='pending'` and `replitUserId=null`
    3. When user logs in with Replit, system matches by email and links their Replit ID
    4. Account status changes to `linked` and subsequent logins use Replit ID lookup
  - **Database Schema Changes**:
    - Added: `replitUserId` varchar unique nullable field (stores Replit user ID after linking)
    - Modified: `id` field now stores a generated UUID (not Replit ID)
    - Modified: `email` field is now NOT NULL and unique
    - Added: `accountStatus` varchar field (values: 'pending' or 'linked')
  - **Backend Changes**:
    - New storage methods: `getUserByReplitId()`, `getUserByEmail()`, `linkReplitAccount()`
    - Updated OAuth callback to match users by email on first login
    - Fixed `requirePermission` middleware to resolve database user ID from Replit ID
    - Updated user creation API to accept email instead of Replit ID
  - **Frontend Changes**:
    - User creation form now asks for email (required) and name (optional)
    - Added "Account Status" filter showing pending/linked accounts
    - User table shows account status badge and Replit user ID when linked
    - Removed Replit ID input field from user creation dialog
  - **Benefits**: Admins only need to know a user's email address to provision them, making onboarding much easier

## Replit Auth Migration (November 4, 2025)
- **Authentication System Overhaul**: Migrated from username/password to Replit Login (OAuth)
  - **Restricted Access Model**: Users must be pre-created by administrators before they can log in
  - **Database Schema Changes**:
    - Removed: `username` and `password_hash` fields from users table (now uses `email`, `replitUserId` instead)
    - Added: `email`, `firstName`, `lastName`, `profileImageUrl`, `updatedAt` fields
    - Added: `sessions` table for PostgreSQL-based session storage
  - **Replit Auth Implementation** (server/replitAuth.ts):
    - Uses OpenID Connect for OAuth authentication
    - Implements `upsertUser` to update user information on each login
    - Validates that authenticated Replit users exist in the database before granting access
    - Session security configured for both development (HTTP) and production (HTTPS)
  - **Backend Changes**:
    - Removed Passport Local strategy and bcrypt dependency
    - Updated `requirePermission` middleware to extract userId from `req.user.claims.sub`
    - Added GET `/api/auth/user` endpoint for client authentication state
    - Added `/unauthorized` route for access denied scenarios
    - Removed POST `/api/login` and POST `/api/register` routes
  - **Frontend Changes**:
    - Updated login page with "Sign in with Replit" button
    - Modified `AuthContext` to use Replit Auth redirects
    - Updated admin user management to show Replit user fields (ID, email, name)
    - Removed password change functionality from user account page
    - Created `authUtils.ts` with `isUnauthorizedError` helper function
  - **Session Configuration**:
    - `SESSION_SECRET` required in production, fallback provided for development
    - Cookies flagged `secure: true` only in production to support HTTP in development
  - **RBAC Preserved**: All existing role and permission checks remain functional

## Sequential ID Field Addition (November 3, 2025)
- **New Field**: Added `sirius_id` to both Workers and Employers tables
  - Data Type: Serial (auto-incrementing integer)
  - Constraints: NOT NULL, UNIQUE
  - Purpose: Provides sequential, human-readable IDs for both workers and employers
  - Existing records automatically assigned sequential IDs (1, 2, 3, etc.)
  - Database sequences created: `workers_sirius_id_seq`, `employers_sirius_id_seq`

## Employers Table Migration (November 2, 2025)
- **ID Type Change**: Employers table migrated from manual text IDs to auto-generated UUIDs
  - Old: `id: text("id").primaryKey()` - Required manual input
  - New: `id: varchar("id").primaryKey().default(sql`gen_random_uuid()`)` - Auto-generated
  - Existing employer data preserved (names and active status) with new UUID identifiers
  - Frontend form updated to remove ID input field
  - Backend API no longer requires or accepts ID in POST requests

## Worker ID Management (November 2, 2025)
- **Worker ID Types Configuration**: New configuration page at `/config/worker-id-types`
  - Manages types of identification numbers that can be assigned to workers
  - Full CRUD operations (Create, Read, Update, Delete)
  - Sequence-based sorting with up/down arrow controls
  - Optional regex validator field for each ID type enforced client-side and server-side
  - Database Table: `options_worker_id_type` (id, name, sequence, validator)
  - Navigation: Added to configuration sidebar (requires variables.manage permission)
- **Worker IDs Management**: Enhanced worker detail IDs tab
  - Allows creating multiple identification numbers per worker
  - Each ID has a type (from configured ID types) and a value
  - Database Table: `worker_ids` (id, workerId, typeId, value)
  - Client-side and server-side regex validation based on ID type
  - Inline editing and deletion with comprehensive error messaging
  - UI displays validation pattern to users when selecting ID type
- **API Routes**:
  - Worker ID Types: GET/POST/PUT/DELETE `/api/worker-id-types` (requires variables.manage)
  - Worker IDs: GET `/api/workers/:workerId/ids`, POST `/api/workers/:workerId/ids`, PUT/DELETE `/api/worker-ids/:id` (requires workers.manage)
- **Data-testid Compliance**: All interactive elements include required data-testid attributes for automated testing