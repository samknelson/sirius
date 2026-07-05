import { pgTable, varchar, jsonb, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { grievances } from "./schema";
import { contractSections, contracts } from "../contract/schema";

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

// A link between a grievance and a contract. Owned by the `grievance.contract`
// component; requires the `grievance` and `contract` components to be enabled
// first because `grievance_id` references the `grievances` table and
// `contract_id` references the `contracts` table.
//
// `grievance_id` is unique — a grievance links to at most one contract — and
// cascades on delete (removing a grievance removes its contract link).
// `contract_id` restricts on delete — a contract that is referenced by a
// grievance link cannot be deleted until the link is removed.
export const grievanceContracts = pgTable("grievance_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  grievanceId: varchar("grievance_id")
    .notNull()
    .unique()
    .references(() => grievances.id, { onDelete: "cascade" }),
  contractId: varchar("contract_id")
    .notNull()
    .references(() => contracts.id, { onDelete: "restrict" }),
  data: jsonb("data"),
});

export const insertGrievanceContractSchema = createInsertSchema(
  grievanceContracts,
).omit({
  id: true,
});

export type GrievanceContract = typeof grievanceContracts.$inferSelect;
export type InsertGrievanceContract = z.infer<
  typeof insertGrievanceContractSchema
>;
