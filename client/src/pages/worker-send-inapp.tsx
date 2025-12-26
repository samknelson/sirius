import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerSendInAppContent() {
  const { contact } = useWorkerLayout();
  return <CommSendWrapper channel="inapp" contact={contact} />;
}

export default function WorkerSendInApp() {
  return (
    <WorkerLayout activeTab="send-inapp">
      <WorkerSendInAppContent />
    </WorkerLayout>
  );
}
