import type { ChargePluginSummaryProps } from "../registry";

interface BaoEchpSettings {
  policyIds?: string[];
  breakpoints?: unknown[];
}

export default function BaoEchpSummary({ config }: ChargePluginSummaryProps<BaoEchpSettings>) {
  const policyCount = config.settings.policyIds?.length ?? 0;
  const breakpointCount = config.settings.breakpoints?.length ?? 0;
  return (
    <p data-testid={`text-config-pricing-${config.id}`}>
      <strong>Pricing:</strong> {policyCount} {policyCount === 1 ? "policy" : "policies"} enabled,{" "}
      {breakpointCount} {breakpointCount === 1 ? "breakpoint" : "breakpoints"}
    </p>
  );
}
