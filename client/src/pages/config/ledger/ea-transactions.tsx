import { LedgerEaLayout, useLedgerEaLayout } from "@/components/layouts/LedgerEaLayout";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";
import { useParams } from "wouter";

function EaTransactionsContent() {
  const { id } = useParams<{ id: string }>();
  const { currencyCode } = useLedgerEaLayout();

  return (
    <LedgerTransactionsView
      queryKey={[`/api/ledger/ea/${id}/transactions`]}
      title="Transactions"
      csvFilename="ea-transactions"
      currencyCode={currencyCode}
    />
  );
}

export default function EaTransactionsPage() {
  return (
    <LedgerEaLayout activeTab="transactions">
      <EaTransactionsContent />
    </LedgerEaLayout>
  );
}
