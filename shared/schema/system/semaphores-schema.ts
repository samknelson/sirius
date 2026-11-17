import { sql } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, check } from "drizzle-orm/pg-core";

export const semaphores = pgTable("semaphores", {
  key: text("key").primaryKey(),
  ownerProcessId: uuid("owner_process_id"),
  ownershipToken: uuid("ownership_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, t => [
  check("semaphores_ownership_complete", sql`
    (${t.ownerProcessId} IS NULL AND ${t.ownershipToken} IS NULL AND ${t.expiresAt} IS NULL)
    OR (${t.ownerProcessId} IS NOT NULL AND ${t.ownershipToken} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)
  `),
]);
