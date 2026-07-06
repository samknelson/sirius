import { pgTable, varchar, text, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { grievances } from "./schema";

// Owned by the `grievance.settlement` component. Standard unified-options
// shape (name, description, sirius_id, sequence, data). The settlement type's
// icon is stored inside the `data` jsonb, not as its own column.
export const optionsGrievanceSettlementType = pgTable(
  "options_grievance_settlement_type",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull().unique(),
    description: text("description"),
    siriusId: varchar("sirius_id").unique(),
    sequence: integer("sequence").notNull().default(0),
    data: jsonb("data"),
  },
);

export const insertOptionsGrievanceSettlementTypeSchema = createInsertSchema(
  optionsGrievanceSettlementType,
).omit({
  id: true,
});

export type OptionsGrievanceSettlementType =
  typeof optionsGrievanceSettlementType.$inferSelect;
export type InsertOptionsGrievanceSettlementType = z.infer<
  typeof insertOptionsGrievanceSettlementTypeSchema
>;

// A settlement recorded against a grievance. Owned by the
// `grievance.settlement` component; requires the `grievance` component to be
// enabled first because `grievance_id` references its `grievances` table.
//
// `type_ids` is a multi-value reference to
// `options_grievance_settlement_type`. Postgres cannot place a foreign key on
// individual array elements, so this is a plain `text[]` column (mirrors other
// multi-value reference columns such as `school_type_ids`). The intended
// "on delete set null" behavior for removed types is enforced in application
// code, not by a DB constraint.
export const grievanceSettlements = pgTable("grievance_settlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique(),
  grievanceId: varchar("grievance_id")
    .notNull()
    .references(() => grievances.id, { onDelete: "cascade" }),
  typeIds: text("type_ids").array(),
  description: text("description"),
  amount: numeric("amount", { precision: 10, scale: 2 }),
  data: jsonb("data"),
});

export const insertGrievanceSettlementSchema = createInsertSchema(
  grievanceSettlements,
).omit({
  id: true,
});

export type GrievanceSettlement = typeof grievanceSettlements.$inferSelect;
export type InsertGrievanceSettlement = z.infer<
  typeof insertGrievanceSettlementSchema
>;
