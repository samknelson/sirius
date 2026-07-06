import { pgTable, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pluginConfigs, policies, trustBenefits } from "../../schema";

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

export const insertPluginConfigBenefitEligibilitySchema = createInsertSchema(pluginConfigsBenefitEligibility);
export type InsertPluginConfigBenefitEligibility = z.infer<typeof insertPluginConfigBenefitEligibilitySchema>;
export type PluginConfigBenefitEligibility = typeof pluginConfigsBenefitEligibility.$inferSelect;
