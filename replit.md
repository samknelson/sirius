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
- **Module Structure**: Feature-based modules in `server/modules/` with `registerXRoutes()` functions. Each module handles related routes (users, variables, dashboard, postal addresses, phone numbers, address validation, masquerade, bookmarks).
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
    - **Dashboard Plugins**: Extensible plugin system for customizing the dashboard display.
- **User Provisioning**: Email-based user provisioning workflow, linking Replit accounts upon first login.
- **Data Validation**: Extensive Zod schema validation across the application, `libphonenumber-js` for phone numbers, and custom SSN/date validation.
- **Employers**: Employer management with auto-generated UUIDs for identification.
- **Bookmarks**: Entity-agnostic bookmark system allowing users to save workers and employers for quick access. Requires the `bookmark` permission (or admin access). Bookmarks are user-specific and stored with entity type and ID for flexible associations.
- **Dashboard Plugin System**: Extensible architecture allowing admins to enable/disable dashboard widgets. Plugins can display role-specific content and check user permissions.

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

# Dashboard Plugin System

## Architecture
- **Registry Pattern**: Centralized plugin registry in `client/src/plugins/registry.ts`
- **Plugin Types**: Type definitions in `client/src/plugins/types.ts`
- **Plugin Props**: Each plugin receives `userId`, `userRoles` (full Role objects), and `userPermissions`
- **Configuration Storage**: Plugin enabled/disabled state stored in `variables` table as `dashboard_plugin_{pluginId}`

## Plugin Structure
Each plugin is defined in its own folder under `client/src/plugins/` with:
- Plugin component (React component)
- Plugin registration (added to registry)
- Plugin metadata (id, name, description, order, requiredPermissions, enabledByDefault)

## Current Plugins
- **WelcomeMessagesPlugin**: Displays role-specific welcome messages for authenticated users. Shows all messages for roles the user belongs to, with HTML formatting support.

## Adding New Plugins
1. Create plugin folder in `client/src/plugins/`
2. Implement plugin component with `DashboardPluginProps` interface
3. Register plugin in `client/src/plugins/registry.ts` with metadata
4. Plugin will automatically appear in admin configuration page

## Plugin Configuration
- Admins can enable/disable plugins via `/config/dashboard-plugins`
- Plugins respect user permissions via `requiredPermissions` field
- Plugins are displayed in order specified by `order` field
- Default state controlled by `enabledByDefault` field

# Components Feature Flag System

## Architecture
- **Registry Pattern**: Centralized component registry in `shared/components.ts`
- **Component Types**: Type definitions for `ComponentDefinition` and `ComponentConfig` in `shared/components.ts`
- **Configuration Storage**: Component enabled/disabled state stored in `variables` table with `component_` prefix
- **Access Control Integration**: Policies can check component enablement using `{ type: 'component', componentId: 'xxx' }`

## Component Structure
Each component is defined in the registry with:
- `id`: Unique identifier (e.g., "ledger", "ledger.stripe")
- `name`: Human-readable display name
- `description`: Brief explanation of the component's purpose
- `category`: Group classification (core, ledger, sitespecific, cardcheck, login)
- `enabledByDefault`: Boolean flag for default state
- `dependencies`: Optional array of component IDs that must be enabled

## Current Components
- **ledger**: Core ledger functionality
- **ledger.stripe**: Stripe payment integration for ledger
- **cardcheck**: Card verification system
- **sitespecific.gbhet**: Site-specific features for GBHET
- **sitespecific.btu**: Site-specific features for BTU
- **employer.login**: Employer login portal
- **worker.login**: Worker login portal

## Component Management
- Admins can enable/disable components via `/config/components`
- Components are organized by category for easier management
- Component states persist across sessions
- Dependency chains ensure related components work together
- Requires `variables.manage` permission to configure

## API Endpoints
- `GET /api/components/config`: Retrieve all component configurations
- `PUT /api/components/config/:componentId`: Update a component's enabled state

## Using Components in Policies
Components can be used in access control policies to restrict features:
```typescript
{
  type: 'component',
  componentId: 'ledger'
}
```
This allows routes and features to be conditionally enabled based on component state.

# Access Control

## Permissions
The system uses a centralized permission registry (`shared/permissions.ts`) with core permissions including:
- `admin.manage`: Administrative functions, users, roles, and permissions management
- `workers.manage`: Create, update, and delete worker records
- `workers.view`: View worker records and information
- `variables.manage`: Create, update, and delete system variables
- `bookmark`: Create and manage bookmarks for workers and employers
- `masquerade`: Ability to masquerade as other users
- `ledger.employer`: Access to employer ledger functionality
- `ledger.staff`: Access to staff ledger functionality
- `admin`: Administrator level access (bypasses all access checks)

## Policies
Access policies (`server/policies.ts`) define declarative access control requirements:
- `authenticated`: Requires user authentication
- `adminManage`: Requires `admin.manage` permission
- `workersView`: Requires `workers.view` permission
- `workersManage`: Requires `workers.manage` permission
- `employersView`: Requires `employers.view` permission
- `employersManage`: Requires `employers.manage` permission
- `variablesView`: Requires `variables.view` permission
- `variablesManage`: Requires `variables.manage` permission
- `benefitsView`: Requires `benefits.view` permission
- `benefitsManage`: Requires `benefits.manage` permission
- `components`: Requires `variables.manage` permission (for managing component feature flags)
- `bookmark`: Requires `bookmark` permission
- `masquerade`: Requires `masquerade` or `admin` permission

All policies automatically grant access to users with the `admin` permission.