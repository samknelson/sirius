import { SftpClientLayout, useSftpClientLayout } from "@/components/layouts/SftpClientLayout";
import { ActivityLogView } from "@/components/shared";

function SftpClientLogsContent() {
  const { destination } = useSftpClientLayout();

  return <ActivityLogView hostEntityId={destination.id} title="Activity Logs" />;
}

export default function SftpClientLogsPage() {
  return (
    <SftpClientLayout activeTab="logs">
      <SftpClientLogsContent />
    </SftpClientLayout>
  );
}
