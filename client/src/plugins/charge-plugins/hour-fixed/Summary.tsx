import type { ChargePluginSummaryProps } from "../registry";
import { getCurrentRateValue } from "@/lib/rateHistory";

interface HourFixedSettings {
  rateHistory?: Array<{ effectiveDate: string; rate: number }>;
}

export default function HourFixedSummary({ config }: ChargePluginSummaryProps<HourFixedSettings>) {
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
}
