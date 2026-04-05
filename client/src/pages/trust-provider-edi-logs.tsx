import { TrustProviderEdiLayout, useTrustProviderEdiLayout } from "@/components/layouts/TrustProviderEdiLayout";
import { ActivityLogView } from "@/components/shared";

function EdiLogsContent() {
  const { edi } = useTrustProviderEdiLayout();

  return <ActivityLogView hostEntityId={edi.id} title="Activity Logs" />;
}

export default function TrustProviderEdiLogsPage() {
  return (
    <TrustProviderEdiLayout activeTab="logs">
      <EdiLogsContent />
    </TrustProviderEdiLayout>
  );
}
