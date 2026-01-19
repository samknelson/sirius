import { WsClientLayout, useWsClientLayout } from "@/components/layouts/WsClientLayout";
import { ActivityLogView } from "@/components/shared";

function WsClientLogsContent() {
  const { client } = useWsClientLayout();

  return <ActivityLogView hostEntityId={client.id} title="Activity Logs" />;
}

export default function WsClientLogsPage() {
  return (
    <WsClientLayout activeTab="logs">
      <WsClientLogsContent />
    </WsClientLayout>
  );
}
