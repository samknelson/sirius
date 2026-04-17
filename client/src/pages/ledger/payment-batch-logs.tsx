import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { ActivityLogView } from "@/components/shared";

function BatchLogsContent() {
  const { batch } = usePaymentBatchLayout();

  return <ActivityLogView hostEntityId={batch.id} title="Activity Logs" />;
}

export default function PaymentBatchLogsPage() {
  return (
    <PaymentBatchLayout activeTab="logs">
      <BatchLogsContent />
    </PaymentBatchLayout>
  );
}
