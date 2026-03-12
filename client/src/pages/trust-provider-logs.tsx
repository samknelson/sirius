import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import { ActivityLogView } from "@/components/shared";

function TrustProviderLogsContent() {
  const { provider } = useTrustProviderLayout();

  if (!provider) {
    return null;
  }

  return <ActivityLogView hostEntityId={provider.id} title="Activity Logs" />;
}

export default function TrustProviderLogsPage() {
  return (
    <TrustProviderLayout activeTab="logs">
      <TrustProviderLogsContent />
    </TrustProviderLayout>
  );
}
