import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, unique, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pluginConfigs, policies, trustBenefits, workers } from "../../schema";

// Trust benefit eligibility subsidiary — relational dimensions hoisted out of
// the policies.data blob (policy / benefit / applies_to). Owned by the
// `trust.benefits` component: its table is created (and drift-checked) only
// when trust benefits are enabled. Keyed 1:1 by the base `plugin_configs.id`
// via a cascade-delete FK.
export const pluginConfigsBenefitEligibility = pgTable("plugin_configs_benefit_eligibility", {
  id: varchar("id").primaryKey().references(() => pluginConfigs.id, { onDelete: 'cascade' }),
  policy: varchar("policy").references(() => policies.id, { onDelete: 'cascade' }),
  benefit: varchar("benefit").references(() => trustBenefits.id, { onDelete: 'cascade' }),
  appliesTo: varchar("applies_to"),
});

// Worker-month-benefit lifecycle events (start / restart / terminate),
// maintained by the trust-wmb-* denorm plugins. Owned by the `trust.benefits`
// component. `event_type` is deliberately a plain varchar (NOT an enum or
// registry) — sitespecific event types are expected. All writes go through
// `storage.trustWmbEvents` (the trust-wmb denorm plugins are the only
// callers).
export const trustWmbEvents = pgTable("trust_wmb_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  benefitId: varchar("benefit_id").notNull().references(() => trustBenefits.id, { onDelete: 'cascade' }),
  eventType: varchar("event_type").notNull(),
  data: jsonb("data"),
}, (table) => ({
  // Declared in TABLE-column order with an explicit name (see the trust_wmb
  // constraint comment in shared/schema.ts): drizzle-kit push introspects
  // constraint columns in table order, so any other declared order
  // false-positives on db-push runs.
  uniqueWorkerYearMonthBenefitType: unique("trust_wmb_events_worker_year_month_benefit_type_unique").on(
    table.workerId,
    table.year,
    table.month,
    table.benefitId,
    table.eventType,
  ),
}));

export const insertTrustWmbEventSchema = createInsertSchema(trustWmbEvents).omit({ id: true });
export type InsertTrustWmbEvent = z.infer<typeof insertTrustWmbEventSchema>;
export type TrustWmbEvent = typeof trustWmbEvents.$inferSelect;

export const insertPluginConfigBenefitEligibilitySchema = createInsertSchema(pluginConfigsBenefitEligibility);
export type InsertPluginConfigBenefitEligibility = z.infer<typeof insertPluginConfigBenefitEligibilitySchema>;
export type PluginConfigBenefitEligibility = typeof pluginConfigsBenefitEligibility.$inferSelect;
