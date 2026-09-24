import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerSendInAppContent() {
  const { worker, contact } = useWorkerLayout();
  return <CommSendWrapper channel="inapp" contact={contact} composeTarget={{ scope: "worker", recordId: worker.id }} />;
}

export default function WorkerSendInApp() {
  return (
    <WorkerLayout activeTab="send-inapp">
      <WorkerSendInAppContent />
    </WorkerLayout>
  );
}
