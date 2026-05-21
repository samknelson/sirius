import { useParams, useLocation } from "wouter";
import { PaymentForm } from "@/components/ledger/PaymentForm";

export default function PaymentCreate() {
  const { accountId } = useParams<{ accountId: string }>();
  const [, setLocation] = useLocation();

  return (
    <PaymentForm
      mode="create"
      accountId={accountId}
      onSuccess={(data) => {
        if (data?.id) {
          setLocation(`/ledger/payment/${data.id}`);
        } else {
          setLocation(`/ledger/accounts/${accountId}/payments`);
        }
      }}
      onCancel={() => setLocation(`/ledger/accounts/${accountId}/payments`)}
    />
  );
}
