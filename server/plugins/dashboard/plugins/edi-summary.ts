import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import {
  getTrustProviderEdiDashboardRows,
  type TrustProviderEdiDashboardRow,
} from "../../../modules/trust/provider-edi-dashboard";

/**
 * State bucket for one EDI configuration, derived from its most recent
 * wizard run:
 *   - "never run"  — no wizard has ever selected this config
 *   - "error"      — the latest wizard failed
 *   - "complete"   — the latest wizard completed
 *   - otherwise    — the (lowercased) name of the step the wizard is on,
 *                    e.g. "generate" / "deliver", i.e. still in progress
 */
function stateOf(row: TrustProviderEdiDashboardRow): string {
  const w = row.latestWizard;
  if (!w) return "never run";
  if (w.status === "failed") return "error";
  if (w.status === "completed") return "complete";
  return (w.currentStepName ?? w.currentStep ?? "in progress").toLowerCase();
}

export const ediSummaryPlugin: DashboardPlugin = {
  id: "edi-summary",
  name: "EDI",
  description:
    "Summary of EDI configurations and the state of each one's most recent file run",
  requiredComponent: "trust.providers.edi",
  requiredPolicy: "admin",

  content: {
    // Reuses the exact aggregation behind /api/trust/provider-edi/dashboard
    // so the widget always agrees with the EDI page.
    data: async () => {
      const rows = await getTrustProviderEdiDashboardRows();

      const stateCounts = new Map<string, number>();
      for (const row of rows) {
        const state = stateOf(row);
        stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
      }

      return {
        totalConfigs: rows.length,
        // e.g. [{ state: "generate", count: 6 }, { state: "error", count: 1 }, ...]
        stateCounts: Array.from(stateCounts.entries())
          .map(([state, count]) => ({ state, count }))
          .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state)),
        configs: rows.map((row) => ({
          configId: row.configId,
          name: row.configName || row.pluginName,
          providerName: row.providerName,
          state: stateOf(row),
          stepReachedAt: row.latestWizard?.stepReachedAt ?? null,
        })),
      };
    },
  },

  client: {
    component: "edi-summary:EdiSummary",
    order: 40,
    requiredPermissions: ["admin"],
  },
};

registerDashboardPlugin(ediSummaryPlugin);
