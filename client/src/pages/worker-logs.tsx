import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { ActivityLogView } from "@/components/shared";

function WorkerLogsContent() {
  const { worker } = useWorkerLayout();

  return <ActivityLogView hostEntityId={worker.id} title="Activity Logs" />;
}

export default function WorkerLogsPage() {
  return (
    <WorkerLayout activeTab="logs">
      <WorkerLogsContent />
    </WorkerLayout>
  );
}
