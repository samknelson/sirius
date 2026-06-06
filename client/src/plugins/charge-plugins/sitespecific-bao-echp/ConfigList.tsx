import type { ChargePluginConfigProps } from "../registry";
import SharedConfigList, { type ChargePluginConfigRow } from "../SharedConfigList";

interface BaoEchpSettings {
  policyIds?: string[];
  breakpoints?: unknown[];
}

export default function BaoEchpConfigList({ pluginId }: ChargePluginConfigProps) {
  return (
    <SharedConfigList
      pluginId={pluginId}
      title="Event Center Hours Purchase Charge Configurations"
      description="Manage the accounts that worker ECHP charges are posted to"
      cardDescription="Each configuration posts ECHP charges to its selected account"
      emptyMessage="ECHP charges will not be posted until a configuration is added."
      renderSummary={(config: ChargePluginConfigRow<BaoEchpSettings>) => {
        const policyCount = config.settings.policyIds?.length ?? 0;
        const breakpointCount = config.settings.breakpoints?.length ?? 0;
        return (
          <p data-testid={`text-config-pricing-${config.id}`}>
            <strong>Pricing:</strong> {policyCount} {policyCount === 1 ? "policy" : "policies"} enabled,{" "}
            {breakpointCount} {breakpointCount === 1 ? "breakpoint" : "breakpoints"}
          </p>
        );
      }}
    />
  );
}
