import { PaymentLayout } from "@/components/layouts/PaymentLayout";
import { useParams, useLocation } from "wouter";
import { PaymentForm } from "@/components/ledger/PaymentForm";

function PaymentEditContent() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  return (
    <PaymentForm
      mode="edit"
      paymentId={id}
      onSuccess={() => setLocation(`/ledger/payment/${id}`)}
      onCancel={() => setLocation(`/ledger/payment/${id}`)}
    />
  );
}

export default function PaymentEdit() {
  return (
    <PaymentLayout activeTab="edit">
      <PaymentEditContent />
    </PaymentLayout>
  );
}
