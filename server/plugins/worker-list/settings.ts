import { storage } from "../../storage";
import { MEMBERSHIP_COLUMN_PLUGIN_ID } from "./plugins/membershipColumn";
import type { MembershipColumnSettings } from "./types";

/**
 * Resolve the effective membership-column settings from the enabled
 * `worker-list` / `membership-column` singleton config. Canonical row is the
 * first by (ordering, id) — the storage search's natural order. Returns
 * `null` when no enabled config exists, which callers must treat as
 * "unconfigured" (today's member-status behavior).
 */
export async function getMembershipColumnSettings(): Promise<MembershipColumnSettings | null> {
  const envelopes = await storage.pluginConfigs.search("worker-list", {
    pluginId: MEMBERSHIP_COLUMN_PLUGIN_ID,
    enabled: true,
  });
  if (envelopes.length === 0) return null;
  const data = (envelopes[0].config.data ?? {}) as MembershipColumnSettings;
  return {
    displayMode: data.displayMode === "authorization" ? "authorization" : "member-status",
    accountId: typeof data.accountId === "string" && data.accountId ? data.accountId : undefined,
    cardcheckDefinitionIds: Array.isArray(data.cardcheckDefinitionIds)
      ? data.cardcheckDefinitionIds.filter((id): id is string => typeof id === "string" && !!id)
      : [],
  };
}
