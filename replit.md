# Sirius

Sirius is a full-stack web application designed for comprehensive worker management, streamlining administration, enhancing user experience, and delivering business value through efficient operations.

## Run & Operate

_Populate as you build_

## Stack

-   **Frontend**: React 18, TypeScript, Vite, Wouter, TanStack Query, React Hook Form, Shadcn/ui (Radix UI), Tailwind CSS ("new-york" theme)
-   **Backend**: Express.js, TypeScript
-   **ORM**: Drizzle ORM
-   **Validation**: Zod, libphonenumber-js
-   **Database**: PostgreSQL (Neon Database)
-   **Object Storage**: Replit Object Storage (Google Cloud Storage)
-   **Auth**: Multi-provider (Replit Auth, Okta, SAML/OAuth, Clerk, local)
-   **Logging**: Winston with PostgreSQL backend
-   **Real-time**: WebSockets
-   **Task Scheduling**: node-cron

## Where things live

-   **Database Schema**: `server/schema.ts` (implied by Drizzle ORM usage)
-   **API Routes**: `server/modules/` (feature-based modules)
-   **Frontend Pages**: `client/src/pages/` (lazy-loaded)
-   **UI Components**: `client/src/components/`
-   **Access Control Policies**: `server/modules/*/access.ts` (implied by entity-based policy architecture)
-   **UI Theme**: `tailwind.config.ts` (implied by Tailwind CSS with "new-york" theme)
-   **Wizards**: `server/wizards/types/`, `client/src/components/wizards/steps/`
-   **Dispatch System**: `server/modules/dispatch/`, `client/src/pages/dispatch/`
-   **Ledger System**: `server/modules/ledger/`, `client/src/pages/ledger/`
-   **SFTP Client Destinations**: `server/modules/sftp-client-destination/`, `client/src/pages/config/sftp-client-destinations/`

## Architecture decisions

-   **Centralized Database Access**: All DB interactions are routed through a single storage layer for audit logging, access control, and validation.
-   **Feature-based Module Structure**: Both frontend and backend are organized by feature modules for better maintainability and scalability.
-   **Metadata-driven Configuration**: Configurable settings use a unified, metadata-driven system to dynamically render forms and tables.
-   **Entity-based Access Control**: A modular, entity-based policy architecture with server-side LRU caching ensures fine-grained access control.
-   **Charge Plugin Idempotency**: Charge plugin executions are idempotent via `chargePluginKey` upsert, preventing duplicate ledger entries.
-   **VDB Pension Reconciliation via Cron (not cascade)**: SLA contribution-percent and share-based variable contribution ledger entries are produced by two cron jobs (`gbhet-pension-sla-reconcile`, `gbhet-pension-shares-reconcile`) calling `reconcileContributionPctYears` / `reconcileVariableContributionForAllWorkers` in `server/services/gbhet-pension-sla.ts`. Each batch tracks the `chargePluginKey`s it produces and uses `storage.ledger.entries.deleteOrphansByChargePluginAndKnownKeys` for self-healing orphan cleanup. The previous ledger-entry-saved event-driven cascade plugins and event plumbing have been fully removed.

## Product

-   **Worker Management**: Comprehensive CRUD operations for workers, contacts, and benefits, with search, filtering, and pagination.
-   **Organizational Settings**: Configurable settings for dynamic UI rendering.
-   **Legal Compliance Reporting**: Supports legal compliance through features like employment status mapping in wizards.
-   **Benefit Charge Billing**: Manages financial transactions, including accounts and payments, with entity-specific access.
-   **Dispatch System**: Manages dispatch jobs, types, listings, and detail pages, with a plugin system for worker eligibility.
-   **Multi-Provider Authentication**: Supports various authentication methods including Replit Auth, Okta, and SAML/OAuth.
-   **Wizards**: Flexible workflow state management for multi-step processes and report generation (e.g., Employer Onboarding, GBHET Legal).
-   **Bulk Messaging**: Infrastructure for managing and sending bulk messages across multiple mediums (email, SMS, postal, in-app).

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

-   **Facility Contact Sync**: Renaming a facility must go through `storage.facilities.updateContactName` to keep the facility and its associated contact in sync.
-   **Wizard Access Control**: While `/wizards/:id` only requires authentication, the API endpoints enforce granular authorization.
-   **T631 Facility Sync**: The `sitespecific-t631-facility-fetch` cron job is disabled by default and gated by the `sitespecific.t631.client` component. It only syncs `name` and `sirius_id` and does not delete local-only rows or write arbitrary `data` jsonb.

## Pointers

-   **React Documentation**: [https://react.dev/](https://react.dev/)
-   **Tailwind CSS Documentation**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
-   **Zod Documentation**: [https://zod.dev/](https://zod.dev/)
-   **Drizzle ORM Documentation**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
-   **TanStack Query Documentation**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
-   **Express.js Documentation**: [https://expressjs.com/](https://expressjs.com/)
-   **PostgreSQL Documentation**: [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)