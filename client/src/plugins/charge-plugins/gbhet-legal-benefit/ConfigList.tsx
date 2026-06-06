import { useQuery } from "@tanstack/react-query";
import type { ChargePluginConfigProps } from "../registry";
import SharedConfigList, { type ChargePluginConfigRow } from "../SharedConfigList";
import { TrustBenefit } from "@/lib/policy-types";

interface GbhetLegalBenefitSettings {
  benefitId?: string;
  billingOffsetMonths?: number;
  rateHistory?: Array<{ effectiveDate: string; rate: number }>;
}

export default function GbhetLegalBenefitConfigList({ pluginId }: ChargePluginConfigProps) {
  const { data: benefits = [] } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const getBenefitName = (benefitId?: string) => {
    if (!benefitId) return "Not set";
    return benefits.find((b) => b.id === benefitId)?.name || benefitId;
  };

  const getCurrentRate = (rateHistory?: Array<{ effectiveDate: string; rate: number }>) => {
    if (!rateHistory || rateHistory.length === 0) return "No rates configured";
    const today = new Date().toISOString().split("T")[0];
    const sorted = [...rateHistory].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const current = sorted.find((r) => r.effectiveDate <= today);
    if (!current) return "No active rate";
    return `$${current.rate.toFixed(2)}/month (from ${current.effectiveDate})`;
  };

  return (
    <SharedConfigList
      pluginId={pluginId}
      title="GBHET Legal Benefit Configurations"
      description="Manage monthly rate configurations for GBHET Legal benefit charges based on worker benefits"
      cardDescription="Each configuration applies when workers have the configured benefit"
      emptyMessage="No GBHET Legal benefit configurations yet."
      renderSummary={(config: ChargePluginConfigRow<GbhetLegalBenefitSettings>) => (
        <>
          <p data-testid={`text-config-benefit-${config.id}`}>
            <strong>Benefit:</strong> {getBenefitName(config.settings.benefitId)}
          </p>
          <p data-testid={`text-config-offset-${config.id}`}>
            <strong>Billing Offset:</strong> {config.settings.billingOffsetMonths ?? -3} months
          </p>
          <p data-testid={`text-config-current-rate-${config.id}`}>
            <strong>Current Rate:</strong> {getCurrentRate(config.settings.rateHistory)}
          </p>
        </>
      )}
    />
  );
}
