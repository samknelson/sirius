/**
 * Staging table for the Freeman EDLS migration.
 *
 * This is a holding area, not a destination: it is a faithful local copy of
 * rows from Freeman's legacy system, kept as fetched so they can be inspected
 * before anything is turned into a real record here. Nothing in the running
 * application reads it.
 *
 * The legacy system's node id is the key. It is the only identifier the legacy
 * rows share — the node row and every associated field row address a sheet by
 * `nid` — so it is what a re-run has to match on to update rather than
 * duplicate.
 *
 * Everything fetched for one sheet lives in `data` as JSON rather than in
 * columns. The legacy field tables each carry their own value column
 * (`_value`, `_target_id`, `_tid`, plus `_format` on some), a `delta` for
 * multi-valued fields, and their own envelope columns; flattening that into a
 * fixed set of columns would decide the mapping now, and the mapping is the
 * NEXT stage's decision. Kept whole, nothing is lost in translation.
 */
import { pgTable, varchar, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sitespecificFreemanEdlsMigrate = pgTable("sitespecific_freeman_edls_migrate", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** The legacy system's node id. One staged row per legacy node. */
  nid: varchar("nid").notNull().unique("sitespecific_freeman_edls_migrate_nid_unique"),
  /** The legacy node type, e.g. "sirius_edls_sheet". */
  type: varchar("type").notNull(),
  /** The legacy node row and its field rows, as fetched. */
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
});

export const insertFreemanEdlsMigrateSchema = createInsertSchema(
  sitespecificFreemanEdlsMigrate,
).omit({ id: true });

export type FreemanEdlsMigrateRow = typeof sitespecificFreemanEdlsMigrate.$inferSelect;
export type InsertFreemanEdlsMigrateRow = z.infer<typeof insertFreemanEdlsMigrateSchema>;
