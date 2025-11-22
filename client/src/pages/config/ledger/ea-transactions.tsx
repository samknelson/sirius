import { LedgerEaLayout } from "@/components/layouts/LedgerEaLayout";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";
import { useParams } from "wouter";

function EaTransactionsContent() {
  const { id } = useParams<{ id: string }>();

  return (
    <LedgerTransactionsView
      queryKey={[`/api/ledger/ea/${id}/transactions`]}
      title="Transactions"
      csvFilename="ea-transactions"
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
