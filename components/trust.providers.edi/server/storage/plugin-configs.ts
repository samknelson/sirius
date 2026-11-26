import { eq, isNull, type SQL } from "drizzle-orm";
import { getClient } from "../../../../server/storage/transaction-context";
import type { SubsidiaryStorage } from "../../../../server/storage/system/plugin-configs-subsidiary";
import {
  pluginConfigsTrustProviderEdi,
  type PluginConfigTrustProviderEdi,
  type InsertPluginConfigTrustProviderEdi,
} from "../../shared/schema/trust/provider-edi-schema";

declare module "../../../../server/storage/system/plugin-configs-subsidiary" {
  interface ComponentPluginConfigSubsidiaryRows {
    "trust-provider-edi": PluginConfigTrustProviderEdi;
  }
  interface ComponentSubsidiarySearchParams {
    providerId?: string | null;
    sftpClientId?: string | null;
  }
}

export function createTrustProviderEdiSubsidiaryStorage(): SubsidiaryStorage<
  PluginConfigTrustProviderEdi, InsertPluginConfigTrustProviderEdi
> {
  return {
    table: pluginConfigsTrustProviderEdi,
    async get(id) {
      const [row] = await getClient().select().from(pluginConfigsTrustProviderEdi)
        .where(eq(pluginConfigsTrustProviderEdi.id, id));
      return row || undefined;
    },
    async upsert(row) {
      const [result] = await getClient().insert(pluginConfigsTrustProviderEdi).values(row)
        .onConflictDoUpdate({
          target: pluginConfigsTrustProviderEdi.id,
          set: { providerId: row.providerId ?? null, sftpClientId: row.sftpClientId ?? null },
        }).returning();
      return result;
    },
    buildConditions(params) {
      const out: SQL[] = [];
      for (const key of ["providerId", "sftpClientId"] as const) {
        const value = params[key];
        if (value !== undefined) {
          out.push(value === null ? isNull(pluginConfigsTrustProviderEdi[key]) : eq(pluginConfigsTrustProviderEdi[key], value));
        }
      }
      return out;
    },
  };
}
