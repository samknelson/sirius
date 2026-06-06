import type { ChargePluginConfigProps } from "../registry";
import SharedConfigList from "../SharedConfigList";

export default function BtuDuesAllocationConfigList({ pluginId }: ChargePluginConfigProps) {
  return (
    <SharedConfigList
      pluginId={pluginId}
      title="BTU Dues Allocation Configurations"
      description="Configure which ledger accounts receive dues allocation entries from the import wizard"
      cardDescription="Only dues imports targeting a configured account will create ledger entries"
      emptyMessage="Dues allocation imports will not create ledger entries until a configuration is added."
    />
  );
}
