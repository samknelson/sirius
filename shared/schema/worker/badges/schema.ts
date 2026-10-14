import { sql } from "drizzle-orm";
import { pgTable, varchar, text, jsonb, boolean, timestamp, unique, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, denorm } from "../../../schema";
import type { RecordGoPresentation } from "../../../utils/record-go";

export const optionsWorkerBadgeTypes = pgTable("options_worker_badge_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  icon: varchar("icon"),
  name: varchar("name", { length: 255 }).notNull(),
  siriusId: varchar("sirius_id").unique("options_worker_badge_types_sirius_id_unique"),
  description: text("description"),
  data: jsonb("data"),
});

const optionalText = z.string().trim().nullish().transform(value => value || null).optional();
export const insertOptionsWorkerBadgeTypeSchema = createInsertSchema(optionsWorkerBadgeTypes, {
  name: z.string().trim().min(1).max(255),
  icon: optionalText,
  siriusId: optionalText,
  description: optionalText,
}).omit({ id: true });

export type WorkerBadgeType = typeof optionsWorkerBadgeTypes.$inferSelect;
export type InsertWorkerBadgeType = z.infer<typeof insertOptionsWorkerBadgeTypeSchema>;

/**
 * Derived awards, maintained exclusively by denorm plugins through the shared
 * status/payload lifecycle. Never register this table as editable options or
 * offer manual grant/revoke controls. Badge-type definitions above ARE editable.
 * One copy per worker/type, including inactive/revoked awards; each payload has
 * one owning denorm status row. Future plugins must declare their write ownership.
 */
export const workerBadgesDenorm = pgTable("worker_badges_denorm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  badgeTypeId: varchar("badge_type_id").notNull(),
  denormId: varchar("denorm_id").notNull().references(() => denorm.id, { onDelete: "cascade" }),
  active: boolean("active"),
  grantedTimestamp: timestamp("granted_timestamp"),
  revokedTimestamp: timestamp("revoked_timestamp"),
  data: jsonb("data"),
}, table => [
  // The automatic Drizzle name exceeds Postgres's 63-character limit.
  // Use the short name Postgres also chooses for the migration's inline FK.
  foreignKey({
    name: "worker_badges_denorm_badge_type_id_fkey",
    columns: [table.badgeTypeId],
    foreignColumns: [optionsWorkerBadgeTypes.id],
  }).onDelete("cascade"),
  unique("worker_badges_denorm_worker_badge_type_unique").on(table.workerId, table.badgeTypeId),
  unique("worker_badges_denorm_denorm_id_unique").on(table.denormId),
]);

export const insertWorkerBadgeDenormSchema = createInsertSchema(workerBadgesDenorm).omit({ id: true });
export type WorkerBadgeDenorm = typeof workerBadgesDenorm.$inferSelect;
export type InsertWorkerBadgeDenorm = z.infer<typeof insertWorkerBadgeDenormSchema>;

/** Read-only wire view; no application-managed JSON or unauthorized source ids. */
export interface WorkerBadgeListItem {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  active: boolean | null;
  grantedTimestamp: string | null;
  revokedTimestamp: string | null;
  source: RecordGoPresentation | null;
}
