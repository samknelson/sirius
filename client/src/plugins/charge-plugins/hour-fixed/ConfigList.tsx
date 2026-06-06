import type { ChargePluginConfigProps } from "../registry";
import SharedConfigList, { type ChargePluginConfigRow } from "../SharedConfigList";
import { getCurrentRateValue } from "@/lib/rateHistory";

interface HourFixedSettings {
  rateHistory?: Array<{ effectiveDate: string; rate: number }>;
}

export default function HourFixedConfigList({ pluginId }: ChargePluginConfigProps) {
  return (
    <SharedConfigList
      pluginId={pluginId}
      title="Hour - Fixed Rate Configurations"
      description="Manage hourly rate configurations for charging based on worker hours"
      cardDescription="Add a global configuration and per-employer overrides as needed"
      emptyMessage="No hourly rate configurations yet."
      renderSummary={(config: ChargePluginConfigRow<HourFixedSettings>) => {
        const rate = getCurrentRateValue(config.settings?.rateHistory || []);
        return (
          <>
            <p data-testid={`text-config-rates-${config.id}`}>
              <strong>Rate Entries:</strong> {config.settings?.rateHistory?.length || 0}
            </p>
            <p data-testid={`text-config-current-rate-${config.id}`}>
              <strong>Current Rate:</strong> {rate !== null ? `$${rate.toFixed(2)}/hour` : "Not set"}
            </p>
          </>
        );
      }}
    />
  );
}
