# System Architecture

## UI/UX Decisions
The frontend is built with React 18, TypeScript, Vite, Shadcn/ui (based on Radix UI), and Tailwind CSS with a "new-york" theme, ensuring a modern, accessible, and responsive user interface.

## Technical Implementations
-   **Frontend**: React 18, TypeScript, Vite, Wouter for routing, TanStack Query for server state management, and React Hook Form with Zod for form validation. Pages are lazy-loaded for performance.
-   **Backend**: Express.js with TypeScript, providing a RESTful API structured with feature-based modules.
-   **Authentication**: Supports multi-provider authentication (Replit Auth, Okta, SAML/OAuth, Clerk, local username/password) with environment-driven configuration and masquerade capabilities.
-   **Access Control**: Implements a modular, entity-based policy architecture with server-side LRU caching.
-   **Logging**: Winston logging is integrated with a PostgreSQL backend to maintain audit trails.
-   **Data Storage**: PostgreSQL (Neon Database) is managed using Drizzle ORM.
-   **Object Storage**: Utilizes Replit Object Storage, backed by Google Cloud Storage.
-   **Real-time Notifications**: Features a WebSocket-based push notification system.
-   **Event Bus System**: A typed publish/subscribe event bus facilitates inter-service communication.
-   **Cron Job System**: Provides a framework for scheduling periodic tasks.
-   **Migration Framework**: Manages database schema changes with a versioned migration system.

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
-   **Drizzle Zod**: Integration between Drizzle ORM and Zod.
-   **libphonenumber-js**: Phone number parsing, validation, and formatting.

## File Transfer
-   **ssh2-sftp-client**: SFTP client library.
-   **basic-ftp**: FTP client library.

## Third-Party Integrations
-   **Twilio**: Phone number lookup, validation, and SMS messaging.

## API and State Management
-   **TanStack Query**: Server state management.
-   **Date-fns**: Date utility functions.

## Task Scheduling
-   **node-cron**: Task scheduling and cron job execution.

## Security
-   **DOMPurify**: HTML sanitization.
