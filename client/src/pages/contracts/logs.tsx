import { ContractLayout, useContractLayout } from "@/components/layouts/ContractLayout";
import { ActivityLogView } from "@/components/shared";

function ContractLogsContent() {
  const { contract } = useContractLayout();

  return <ActivityLogView hostEntityId={contract.id} title="Activity Logs" />;
}

export default function ContractLogsPage() {
  return (
    <ContractLayout activeTab="logs">
      <ContractLogsContent />
    </ContractLayout>
  );
}
