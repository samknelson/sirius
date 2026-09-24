import { foreignKey, pgTable, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sftpClientDestinations } from "../system/sftp-client-schema";
import { pluginConfigs, trustProviders } from "../../schema";

// Trust provider EDI subsidiary — relational dimensions for configs of the
// `trust-provider-edi` plugin kind (which provider the EDI file is for, and
// which SFTP destination it is delivered to). Owned by the
// `trust.providers.edi` component: its table is created (and drift-checked)
// only when the component is enabled. Keyed 1:1 by the base
// `plugin_configs.id` via a cascade-delete FK.
//
// This replaced the legacy bespoke `trust_provider_edi` table: the list of
// "EDI Targets" is now simply the list of plugin configs of this kind.
//
// FK names are pinned explicitly — the drizzle auto-generated names exceed
// Postgres's 63-char identifier limit (see memory: drizzle-kit push hazards).
export const pluginConfigsTrustProviderEdi = pgTable("plugin_configs_trust_provider_edi", {
  id: varchar("id").primaryKey(),
  providerId: varchar("provider_id"),
  sftpClientId: varchar("sftp_client_id"),
}, (table) => [
  foreignKey({
    name: "plugin_configs_trust_provider_edi_id_fk",
    columns: [table.id],
    foreignColumns: [pluginConfigs.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "plugin_configs_trust_provider_edi_provider_id_fk",
    columns: [table.providerId],
    foreignColumns: [trustProviders.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "plugin_configs_trust_provider_edi_sftp_client_id_fk",
    columns: [table.sftpClientId],
    foreignColumns: [sftpClientDestinations.id],
  }).onDelete("restrict"),
]);

export const insertPluginConfigTrustProviderEdiSchema = createInsertSchema(pluginConfigsTrustProviderEdi);
export type InsertPluginConfigTrustProviderEdi = z.infer<typeof insertPluginConfigTrustProviderEdiSchema>;
export type PluginConfigTrustProviderEdi = typeof pluginConfigsTrustProviderEdi.$inferSelect;
