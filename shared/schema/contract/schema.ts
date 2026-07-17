import { pgTable, varchar, text, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const contracts = pgTable("contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  stubSections: boolean("stub_sections").notNull().default(false),
  data: jsonb("data"),
});

export const insertContractSchema = createInsertSchema(contracts).omit({
  id: true,
});

export type Contract = typeof contracts.$inferSelect;
export type InsertContract = z.infer<typeof insertContractSchema>;

export const contractArticles = pgTable("contract_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sequence: integer("sequence").notNull().default(0),
  contractId: varchar("contract_id")
    .notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  articleNumber: varchar("article_number"),
  name: varchar("name").notNull(),
  data: jsonb("data"),
});

export const insertContractArticleSchema = createInsertSchema(contractArticles).omit({
  id: true,
});

export type ContractArticle = typeof contractArticles.$inferSelect;
export type InsertContractArticle = z.infer<typeof insertContractArticleSchema>;

export const contractSections = pgTable("contract_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sequence: integer("sequence").notNull().default(0),
  articleId: varchar("article_id")
    .notNull()
    .references(() => contractArticles.id, { onDelete: "cascade" }),
  sectionNumber: varchar("section_number"),
  name: varchar("name").notNull(),
  body: text("body"),
  isStub: boolean("is_stub").notNull().default(false),
  data: jsonb("data"),
});

export const insertContractSectionSchema = createInsertSchema(contractSections).omit({
  id: true,
});

export type ContractSection = typeof contractSections.$inferSelect;
export type InsertContractSection = z.infer<typeof insertContractSectionSchema>;
