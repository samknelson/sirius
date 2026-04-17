import { pgTable, text, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { employers } from "../../schema";

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  siriusId: text("sirius_id").unique().notNull(),
  description: text("description"),
  data: jsonb("data"),
});

export const employerCompanies = pgTable("employer_companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }).unique(),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
});

export const insertEmployerCompanySchema = createInsertSchema(employerCompanies).omit({
  id: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

export type InsertEmployerCompany = z.infer<typeof insertEmployerCompanySchema>;
export type EmployerCompany = typeof employerCompanies.$inferSelect;
