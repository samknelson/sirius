import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerLogCallContent() {
  const { contact } = useWorkerLayout();
  return <CommSendWrapper channel="interaction" contact={contact} />;
}

export default function WorkerLogCall() {
  return (
    <WorkerLayout activeTab="log-call">
      <WorkerLogCallContent />
    </WorkerLayout>
  );
}
