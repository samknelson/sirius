import { LedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";
import { useParams } from "wouter";

function AccountTransactionsContent() {
  const { id } = useParams<{ id: string }>();

  return (
    <LedgerTransactionsView
      queryKey={[`/api/ledger/accounts/${id}/transactions`]}
      title="Transactions"
      csvFilename="account-transactions"
    />
  );
}

export default function AccountTransactionsPage() {
  return (
    <LedgerAccountLayout activeTab="transactions">
      <AccountTransactionsContent />
    </LedgerAccountLayout>
  );
}
