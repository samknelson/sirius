import { DispatchJobGroupLayout, useDispatchJobGroupLayout } from "@/components/layouts/DispatchJobGroupLayout";
import { ActivityLogView } from "@/components/shared";

function JobGroupLogsContent() {
  const { group } = useDispatchJobGroupLayout();

  return <ActivityLogView hostEntityId={group.id} title="Activity Logs" />;
}

export default function DispatchJobGroupLogsPage() {
  return (
    <DispatchJobGroupLayout activeTab="logs">
      <JobGroupLogsContent />
    </DispatchJobGroupLayout>
  );
}
