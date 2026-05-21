import { PaymentLayout, usePaymentLayout } from "@/components/layouts/PaymentLayout";
import { ActivityLogView } from "@/components/shared";

function PaymentLogsContent() {
  const { payment } = usePaymentLayout();

  return <ActivityLogView hostEntityId={payment.id} title="Activity Logs" />;
}

export default function PaymentLogsPage() {
  return (
    <PaymentLayout activeTab="logs">
      <PaymentLogsContent />
    </PaymentLayout>
  );
}
