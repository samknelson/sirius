import { useQuery } from "@tanstack/react-query";
import type { ChargePluginConfigProps } from "../registry";
import SharedConfigList, { type ChargePluginConfigRow } from "../SharedConfigList";
import { EmploymentStatus } from "@/lib/entity-types";

interface GbheHourlyChargeSettings {
  chargeTo?: "worker" | "employer";
  employmentStatusIds?: string[];
  specialDesignationMemberStatusIds?: string[];
  specialDesignationMonthlyHours?: number;
  rateHistory?: Array<{ effectiveDate: string; rate: number }>;
}

export default function GbheHourlyChargeConfigList({ pluginId }: ChargePluginConfigProps) {
  const { data: employmentStatuses = [] } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/options/employment-status"],
  });

  const getEmploymentStatusNames = (statusIds?: string[]) => {
    if (!statusIds || statusIds.length === 0) return "All statuses";
    return statusIds
      .map((id) => employmentStatuses.find((s) => s.id === id)?.name || id)
      .join(", ");
  };

  const getCurrentRate = (rateHistory?: Array<{ effectiveDate: string; rate: number }>) => {
    if (!rateHistory || rateHistory.length === 0) return "No rates configured";
    const today = new Date().toISOString().split("T")[0];
    const sorted = [...rateHistory].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const current = sorted.find((r) => r.effectiveDate <= today);
    if (!current) return "No active rate";
    return `$${current.rate.toFixed(2)}/hr (from ${current.effectiveDate})`;
  };

  return (
    <SharedConfigList
      pluginId={pluginId}
      title="GBHE Hourly Charge Configurations"
      description="Charge based on hours worked, with special-designation workers billed fixed monthly hours"
      cardDescription="Add a global configuration and per-employer overrides as needed"
      emptyMessage="No GBHE hourly charge configurations yet."
      renderSummary={(config: ChargePluginConfigRow<GbheHourlyChargeSettings>) => (
        <>
          <p data-testid={`text-config-charge-to-${config.id}`}>
            <strong>Charge To:</strong> {config.settings.chargeTo === "worker" ? "Worker" : "Employer"}
          </p>
          <p data-testid={`text-config-status-${config.id}`}>
            <strong>Employment Status:</strong> {getEmploymentStatusNames(config.settings.employmentStatusIds)}
          </p>
          <p data-testid={`text-config-special-${config.id}`}>
            <strong>Special Designation:</strong>{" "}
            {config.settings.specialDesignationMemberStatusIds?.length
              ? `${config.settings.specialDesignationMemberStatusIds.length} status(es) @ ${config.settings.specialDesignationMonthlyHours ?? 135} hrs/mo`
              : "None"}
          </p>
          <p data-testid={`text-config-current-rate-${config.id}`}>
            <strong>Current Rate:</strong> {getCurrentRate(config.settings.rateHistory)}
          </p>
        </>
      )}
    />
  );
}
