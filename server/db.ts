/**
 * @deprecated DO NOT import from this file directly.
 * 
 * ARCHITECTURE RULE: All database access must go through the storage layer.
 * 
 * - For route handlers and modules: use `storage` from "server/storage"
 * - For storage modules: import from "./db" (relative within storage folder)
 * - For infrastructure code that legitimately needs direct db access: 
 *   import from "server/storage/db" and document the reason
 * 
 * This re-export exists only for backwards compatibility during migration.
 * New code importing from this file will be flagged by ESLint.
 * 
 * See replit.md "Database Access Architecture" for details.
 */
export { db, pool } from "./storage/db";
