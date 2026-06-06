import type { ChargePluginConfigProps } from "../registry";
import SharedConfigList from "../SharedConfigList";

export default function GbhetPensionSlaHourlyConfigList({ pluginId }: ChargePluginConfigProps) {
  return (
    <SharedConfigList
      pluginId={pluginId}
      title="GBHET Pension SLA Configurations"
      description="Set the ledger account that pension SLA (sub-local assessment) charges are posted to"
      cardDescription="Pension SLA charges post to the account selected here"
      emptyMessage="Pension SLA charges will not be posted until an account is configured."
    />
  );
}
