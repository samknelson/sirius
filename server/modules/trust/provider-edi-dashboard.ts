import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { requireAccess } from "../../services/access-policy-evaluator";
import { wizardPluginRegistry } from "../../plugins/wizards";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const WIZARD_TYPE = "trust_provider_edi";
const COMPONENT = "trust.providers.edi";

interface LatestWizardSummary {
  wizardId: string;
  status: string;
  currentStep: string | null;
  currentStepName: string | null;
  stepReachedAt: string | null;
  recordCount: number | null;
}

export interface TrustProviderEdiDashboardRow {
  configId: string;
  configName: string | null;
  pluginId: string;
  pluginName: string;
  providerId: string | null;
  providerName: string | null;
  sftpClientId: string | null;
  latestWizard: LatestWizardSummary | null;
}

/**
 * When did the wizard "arrive" at its current step? The dispatcher stamps
 * `completedAt` on each finished step, so the latest completedAt across all
 * step progress entries is the moment the wizard advanced to where it is
 * now. Falls back to the wizard's creation date for a fresh wizard.
 */
function stepReachedAt(wizard: { date: Date | string; data: unknown }): string | null {
  const progress = ((wizard.data as any)?.progress ?? {}) as Record<
    string,
    { completedAt?: string }
  >;
  let latest: string | null = null;
  for (const entry of Object.values(progress)) {
    if (entry?.completedAt && (!latest || entry.completedAt > latest)) {
      latest = entry.completedAt;
    }
  }
  if (latest) return latest;
  const d = wizard.date;
  return d ? new Date(d).toISOString() : null;
}

function summarizeWizard(wizard: {
  id: string;
  status: string;
  currentStep: string | null;
  date: Date | string;
  data: unknown;
}): LatestWizardSummary {
  const data = (wizard.data as any) ?? {};
  const plugin = wizardPluginRegistry.get(WIZARD_TYPE);
  const step = plugin?.steps.find((s) => s.id === wizard.currentStep);
  const recordCount =
    data.delivery?.rowCount ??
    data.reportMeta?.recordCount ??
    data.recordCount ??
    null;
  return {
    wizardId: wizard.id,
    status: wizard.status,
    currentStep: wizard.currentStep,
    currentStepName: step?.name ?? wizard.currentStep,
    stepReachedAt: stepReachedAt(wizard),
    recordCount: typeof recordCount === "number" ? recordCount : null,
  };
}

/**
 * Shared aggregation: every enabled `trust-provider-edi` configuration
 * joined with its provider name and a summary of the most recent
 * `trust_provider_edi` wizard whose selected config
 * (`data.config.configId`) matches. Used by both the EDI page endpoint
 * below and the "EDI" dashboard widget so the two always agree.
 */
export async function getTrustProviderEdiDashboardRows(): Promise<
  TrustProviderEdiDashboardRow[]
> {
  const [envelopes, providers, wizards] = await Promise.all([
    storage.pluginConfigs.search("trust-provider-edi", { enabled: true }),
    storage.trustProviders.getAllTrustProviders(),
    storage.wizards.list({ type: WIZARD_TYPE }),
  ]);

  const providerNames = new Map<string, string>(
    providers.map((p: { id: string; name: string }) => [p.id, p.name]),
  );

  // Latest wizard per selected configId (wizards store the chosen
  // configuration under data.config.configId).
  const latestByConfig = new Map<string, (typeof wizards)[number]>();
  for (const w of wizards) {
    const configId = (w.data as any)?.config?.configId;
    if (!configId) continue;
    const prev = latestByConfig.get(configId);
    if (!prev || new Date(w.date) > new Date(prev.date)) {
      latestByConfig.set(configId, w);
    }
  }

  const { trustProviderEdiPluginRegistry } = await import(
    "../../plugins/trust/provider-edi/registry"
  );

  const rows: TrustProviderEdiDashboardRow[] = envelopes.map((e) => {
    const providerId = (e.subsidiary as any)?.providerId ?? null;
    const ediPlugin = trustProviderEdiPluginRegistry.get(e.config.pluginId);
    const latest = latestByConfig.get(e.config.id);
    return {
      configId: e.config.id,
      configName: e.config.name,
      pluginId: e.config.pluginId,
      pluginName: ediPlugin?.name ?? e.config.pluginId,
      providerId,
      providerName: providerId ? providerNames.get(providerId) ?? null : null,
      sftpClientId: (e.subsidiary as any)?.sftpClientId ?? null,
      latestWizard: latest ? summarizeWizard(latest) : null,
    };
  });

  // Sort by provider name (rows with no provider last), then config name.
  rows.sort((a, b) => {
    const pa = a.providerName ?? "\uffff";
    const pb = b.providerName ?? "\uffff";
    const byProvider = pa.localeCompare(pb);
    if (byProvider !== 0) return byProvider;
    return (a.configName ?? a.pluginName).localeCompare(
      b.configName ?? b.pluginName,
    );
  });

  return rows;
}

/**
 * EDI page endpoint. Gated on the same component + admin policy as the
 * other trust provider EDI surfaces (the plugin kind and the wizard both
 * declare `trust.providers.edi` + admin).
 */
export function registerTrustProviderEdiDashboardRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
): void {
  app.get(
    "/api/trust/provider-edi/dashboard",
    requireAuth,
    requireComponent(COMPONENT),
    requireAccess("admin"),
    async (_req, res) => {
      try {
        res.json({ rows: await getTrustProviderEdiDashboardRows() });
      } catch (error) {
        res.status(500).json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to load EDI dashboard",
        });
      }
    },
  );
}
