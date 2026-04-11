import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { ActivityLogView } from "@/components/shared";

function BulkMessageLogsContent() {
  const { bulkMessage } = useBulkMessageLayout();

  return <ActivityLogView hostEntityId={bulkMessage.id} title="Activity Logs" />;
}

export default function BulkMessageLogsPage() {
  return (
    <BulkMessageLayout activeTab="logs">
      <BulkMessageLogsContent />
    </BulkMessageLayout>
  );
}
