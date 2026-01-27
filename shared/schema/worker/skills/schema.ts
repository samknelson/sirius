import { pgTable, varchar, text, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

export const optionsSkills = pgTable("options_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  data: jsonb("data"),
});

export const insertOptionsSkillsSchema = createInsertSchema(optionsSkills).omit({
  id: true,
});

export type OptionsSkill = typeof optionsSkills.$inferSelect;
export type InsertOptionsSkill = z.infer<typeof insertOptionsSkillsSchema>;

export const workerSkills = pgTable("worker_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  skillId: varchar("skill_id").notNull().references(() => optionsSkills.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
}, (table) => ({
  uniqueWorkerSkill: unique().on(table.workerId, table.skillId),
}));

export const insertWorkerSkillsSchema = createInsertSchema(workerSkills).omit({
  id: true,
});

export type WorkerSkill = typeof workerSkills.$inferSelect;
export type InsertWorkerSkill = z.infer<typeof insertWorkerSkillsSchema>;
