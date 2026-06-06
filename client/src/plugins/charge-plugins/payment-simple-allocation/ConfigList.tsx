import type { ChargePluginConfigProps } from "../registry";
import SharedConfigList from "../SharedConfigList";

export default function PaymentSimpleAllocationConfigList({ pluginId }: ChargePluginConfigProps) {
  return (
    <SharedConfigList
      pluginId={pluginId}
      title="Payment Simple Allocation Configurations"
      description="Automatically create ledger entries when payments are saved on configured accounts"
      cardDescription="Each configuration watches one account and creates a ledger entry when a cleared payment is saved"
      emptyMessage="No payment allocation configurations yet."
    />
  );
}
