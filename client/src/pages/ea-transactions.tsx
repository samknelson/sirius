import { EALayout, useEALayout } from "@/components/layouts/EALayout";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";
import { useParams } from "wouter";

function EATransactionsContent() {
  const { id } = useParams<{ id: string }>();
  const { currencyCode } = useEALayout();

  return (
    <LedgerTransactionsView
      queryKey={[`/api/ledger/ea/${id}/transactions`]}
      title="Transactions"
      csvFilename="ea-transactions"
      currencyCode={currencyCode}
      showEntityType={false}
      showEntityName={false}
      showEaAccount={false}
      showEaLink={false}
    />
  );
}

export default function EATransactionsPage() {
  return (
    <EALayout activeTab="transactions">
      <EATransactionsContent />
    </EALayout>
  );
}
