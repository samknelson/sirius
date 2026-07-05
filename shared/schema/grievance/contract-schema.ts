import { pgTable, varchar, jsonb, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { grievances } from "./schema";
import { contractSections } from "../contract/schema";

// A link between a grievance and a contract section. Owned by the
// `grievance.contract` component; requires the `grievance` and `contract`
// components to be enabled first because `grievance_id` references the
// `grievances` table and `section_id` references the `contract_sections`
// table.
//
// `grievance_id` cascades on delete (removing a grievance removes its section
// links). `section_id` restricts on delete — a contract section that is
// referenced by a grievance link cannot be deleted until the link is removed.
export const grievanceContractSections = pgTable("grievance_contract_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  grievanceId: varchar("grievance_id")
    .notNull()
    .references(() => grievances.id, { onDelete: "cascade" }),
  sectionId: varchar("section_id")
    .notNull()
    .references(() => contractSections.id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const insertGrievanceContractSectionSchema = createInsertSchema(
  grievanceContractSections,
).omit({
  id: true,
});

export type GrievanceContractSection =
  typeof grievanceContractSections.$inferSelect;
export type InsertGrievanceContractSection = z.infer<
  typeof insertGrievanceContractSectionSchema
>;
