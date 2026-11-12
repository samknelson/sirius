import type { IStorage } from "../../storage";
import type { FeedField } from "./engine/feed";
import {
  benefitConfigurationError, mappedBenefitFieldIds, type GbhetBenefitSetup,
} from "../../../shared/gbhet-legal-benefits";
import { mergeEnabledChargeConfigs, toChargeConfig } from "../ledger/charge/charge-config-resolution";

/** Use the same account-scoped employer overrides as Legal billing. Multiple
 * surviving configs may safely agree on one benefit; conflicting ones cannot
 * supply an implicit default. Manual active-benefit selections remain valid. */
export async function loadGbhetBenefitSetup(
  storage: IStorage, fields: FeedField[], employerId: string | null,
): Promise<GbhetBenefitSetup> {
  const [benefits, globals, employers] = await Promise.all([
    storage.trustBenefits.getAllTrustBenefits(),
    storage.pluginConfigs.search("charge", {
      pluginId: "gbhet-legal-benefit", enabled: true, scope: "global", employerId: null,
    }),
    employerId ? storage.pluginConfigs.search("charge", {
      pluginId: "gbhet-legal-benefit", enabled: true, scope: "employer", employerId,
    }) : Promise.resolve([]),
  ]);
  const configs = mergeEnabledChargeConfigs(globals.map(toChargeConfig), employers.map(toChargeConfig));
  const ids = configs.map(config => (config.settings as { benefitId?: unknown } | null)?.benefitId);
  const unique = new Set(ids);
  const id = ids[0];
  const selected = unique.size === 1 && typeof id === "string"
    ? benefits.find(benefit => benefit.id === id && benefit.isActive) : undefined;
  return {
    fields,
    benefits: benefits.map(benefit => ({
      id: benefit.id, name: benefit.name, isActive: benefit.isActive,
      benefitTypeName: benefit.benefitTypeName,
    })),
    defaultBenefit: selected ? { id: selected.id, name: selected.name } : null,
    defaultBenefitWarning: selected ? null
      : "A unique active Legal benefit could not be determined from this employer's Legal configuration. Select an active benefit for each mapped field and save.",
  };
}

/** Re-read benefit availability at each live boundary; never trust a client or
 * an old validation result to establish eligibility associations. */
export async function assertGbhetBenefitConfiguration(
  storage: IStorage, fields: FeedField[], data: Record<string, any>,
) {
  const ids = mappedBenefitFieldIds(fields, data.columnMapping);
  const structuralError = benefitConfigurationError(ids, data.benefitConfig);
  if (structuralError) throw new Error(structuralError);
  const options = await storage.trustBenefits.getActiveTrustBenefitOptions();
  const error = benefitConfigurationError(ids, data.benefitConfig, new Set(options.map(option => option.id)));
  if (error) throw new Error(error);
}
