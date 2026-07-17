import { foreignKey, pgTable, text, varchar, jsonb, integer, numeric, unique, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, optionsClassifications, employers } from "../../../schema";

export const gbhetPensionBenefitSchedules = pgTable("gbhet_pension_benefit_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  plan: varchar("plan", { length: 1 }).notNull().default("A"),
  monthlyBenefitRate: numeric("monthly_benefit_rate", { precision: 12, scale: 2 }).notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_benefit_schedules_year_plan_unique").on(table.year, table.plan),
]);

export const insertGbhetPensionBenefitScheduleSchema = createInsertSchema(gbhetPensionBenefitSchedules).omit({
  id: true,
});

export type GbhetPensionBenefitSchedule = typeof gbhetPensionBenefitSchedules.$inferSelect;
export type InsertGbhetPensionBenefitSchedule = z.infer<typeof insertGbhetPensionBenefitScheduleSchema>;

export const pensionPlanTypeEnum = z.enum(["A", "B"]);
export type PensionPlanType = z.infer<typeof pensionPlanTypeEnum>;

export const gbhetPensionAccrualTiers = pgTable("gbhet_pension_accrual_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  minHours: numeric("min_hours", { precision: 10, scale: 2 }).notNull(),
  accrualPct: numeric("accrual_pct", { precision: 10, scale: 4 }).notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_accrual_tiers_year_hours_unique").on(table.year, table.minHours),
]);

export const insertGbhetPensionAccrualTierSchema = createInsertSchema(gbhetPensionAccrualTiers).omit({
  id: true,
});

export type GbhetPensionAccrualTier = typeof gbhetPensionAccrualTiers.$inferSelect;
export type InsertGbhetPensionAccrualTier = z.infer<typeof insertGbhetPensionAccrualTierSchema>;

export const gbhetPensionEmployerPlans = pgTable("gbhet_pension_employer_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  plan: varchar("plan", { length: 1 }).notNull().default("A"),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_employer_plans_employer_unique").on(table.employerId),
]);

export const insertGbhetPensionEmployerPlanSchema = createInsertSchema(gbhetPensionEmployerPlans).omit({
  id: true,
}).extend({
  plan: pensionPlanTypeEnum,
});

export type GbhetPensionEmployerPlan = typeof gbhetPensionEmployerPlans.$inferSelect;
export type InsertGbhetPensionEmployerPlan = z.infer<typeof insertGbhetPensionEmployerPlanSchema>;

export const gbhetPensionAnnualSummary = pgTable("gbhet_pension_annual_summary", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  year: integer("year").notNull(),
  totalPensionHours: numeric("total_pension_hours", { precision: 10, scale: 2 }).notNull().default("0"),
  classificationId: varchar("classification_id"),
  isSpecialDesignation: boolean("is_special_designation").notNull().default(false),
  tierId: varchar("tier_id"),
  accrualPct: numeric("accrual_pct", { precision: 6, scale: 4 }),
  monthlyBenefitRate: numeric("monthly_benefit_rate", { precision: 12, scale: 2 }),
  annualAccrual: numeric("annual_accrual", { precision: 12, scale: 2 }),
  qualified: boolean("qualified").notNull().default(false),
  qualificationThresholdHours: numeric("qualification_threshold_hours", { precision: 10, scale: 2 }).notNull().default("500"),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_annual_summary_worker_year_unique").on(table.workerId, table.year),
  foreignKey({
    name: "gbhet_pension_annual_summary_classification_id_options_classifi",
    columns: [table.classificationId],
    foreignColumns: [optionsClassifications.id],
  }).onDelete("set null"),
  foreignKey({
    name: "gbhet_pension_annual_summary_tier_id_gbhet_pension_accrual_tier",
    columns: [table.tierId],
    foreignColumns: [gbhetPensionAccrualTiers.id],
  }).onDelete("set null"),
]);

export const insertGbhetPensionAnnualSummarySchema = createInsertSchema(gbhetPensionAnnualSummary).omit({
  id: true,
});

export type GbhetPensionAnnualSummary = typeof gbhetPensionAnnualSummary.$inferSelect;
export type InsertGbhetPensionAnnualSummary = z.infer<typeof insertGbhetPensionAnnualSummarySchema>;

export const accrualMethodEnum = z.enum(["tiered", "contribution_pct"]);
export type AccrualMethod = z.infer<typeof accrualMethodEnum>;

export const gbhetPensionPlanYears = pgTable("gbhet_pension_plan_years", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  accrualMethod: varchar("accrual_method", { length: 20 }).notNull(),
  contributionPct: numeric("contribution_pct", { precision: 6, scale: 4 }),
  specialDesignationContributionPct: numeric("special_designation_contribution_pct", { precision: 6, scale: 4 }),
  qualificationThresholdHours: numeric("qualification_threshold_hours", { precision: 10, scale: 2 }).notNull().default("500"),
  specialDesignationMonthlyHours: numeric("special_designation_monthly_hours", { precision: 10, scale: 2 }).notNull().default("135"),
  shareValue: numeric("share_value", { precision: 12, scale: 6 }),
  notes: text("notes"),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_plan_years_year_unique").on(table.year),
]);

export const insertGbhetPensionPlanYearSchema = createInsertSchema(gbhetPensionPlanYears).omit({
  id: true,
}).extend({
  accrualMethod: accrualMethodEnum,
  contributionPct: z.string().nullable().optional(),
  specialDesignationContributionPct: z.string().nullable().optional(),
  qualificationThresholdHours: z.string().optional(),
  specialDesignationMonthlyHours: z.string().optional(),
  shareValue: z.string().nullable().optional(),
});

export type GbhetPensionPlanYear = typeof gbhetPensionPlanYears.$inferSelect;
export type InsertGbhetPensionPlanYear = z.infer<typeof insertGbhetPensionPlanYearSchema>;

export const vdbElectionTypeEnum = z.enum(["mandatory", "lump", "lumpearly", "life", "5cc", "50js", "75js", "100js"]);
export type VdbElectionType = z.infer<typeof vdbElectionTypeEnum>;

export const gbhetPensionAiFactors = pgTable("gbhet_pension_ai_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  age: integer("age").notNull(),
  factor: numeric("factor", { precision: 20, scale: 6 }).notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_ai_factors_age_unique").on(table.age),
]);

export const insertGbhetPensionAiFactorSchema = createInsertSchema(gbhetPensionAiFactors).omit({
  id: true,
});

export type GbhetPensionAiFactor = typeof gbhetPensionAiFactors.$inferSelect;
export type InsertGbhetPensionAiFactor = z.infer<typeof insertGbhetPensionAiFactorSchema>;

export const gbhetPensionPayoutFactors = pgTable("gbhet_pension_payout_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  electionType: varchar("election_type", { length: 20 }).notNull(),
  subscriberAge: integer("subscriber_age").notNull(),
  beneficiaryAge: integer("beneficiary_age"),
  factorYear: integer("factor_year").notNull().default(0),
  factor: numeric("factor", { precision: 12, scale: 6 }).notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_payout_factors_type_ages_year_unique").on(table.electionType, table.subscriberAge, table.beneficiaryAge, table.factorYear),
]);

export const insertGbhetPensionPayoutFactorSchema = createInsertSchema(gbhetPensionPayoutFactors).omit({
  id: true,
});

export type GbhetPensionPayoutFactor = typeof gbhetPensionPayoutFactors.$inferSelect;
export type InsertGbhetPensionPayoutFactor = z.infer<typeof insertGbhetPensionPayoutFactorSchema>;

export const gbhetPensionEarlyRetirementFactors = pgTable("gbhet_pension_early_retirement_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reason: varchar("reason", { length: 50 }).notNull(),
  monthlyFactor: numeric("monthly_factor", { precision: 12, scale: 8 }).notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_early_retirement_factors_reason_unique").on(table.reason),
]);

export const insertGbhetPensionEarlyRetirementFactorSchema = createInsertSchema(gbhetPensionEarlyRetirementFactors).omit({
  id: true,
});

export type GbhetPensionEarlyRetirementFactor = typeof gbhetPensionEarlyRetirementFactors.$inferSelect;
export type InsertGbhetPensionEarlyRetirementFactor = z.infer<typeof insertGbhetPensionEarlyRetirementFactorSchema>;

export const gbhetPensionInterestRates = pgTable("gbhet_pension_interest_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  rate: numeric("rate", { precision: 12, scale: 8 }).notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_interest_rates_year_unique").on(table.year),
]);

export const insertGbhetPensionInterestRateSchema = createInsertSchema(gbhetPensionInterestRates).omit({
  id: true,
});

export type GbhetPensionInterestRate = typeof gbhetPensionInterestRates.$inferSelect;
export type InsertGbhetPensionInterestRate = z.infer<typeof insertGbhetPensionInterestRateSchema>;

export const gbhetPensionShareValues = pgTable("gbhet_pension_share_values", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  effectiveDate: varchar("effective_date", { length: 10 }).notNull(),
  shareValue: numeric("share_value", { precision: 12, scale: 6 }).notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_pension_share_values_date_unique").on(table.effectiveDate),
]);

export const insertGbhetPensionShareValueSchema = createInsertSchema(gbhetPensionShareValues).omit({
  id: true,
});

export type GbhetPensionShareValue = typeof gbhetPensionShareValues.$inferSelect;
export type InsertGbhetPensionShareValue = z.infer<typeof insertGbhetPensionShareValueSchema>;
