import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerSendPostalContent() {
  const { contact } = useWorkerLayout();
  return <CommSendWrapper channel="postal" contact={contact} />;
}

export default function WorkerSendPostal() {
  return (
    <WorkerLayout activeTab="send-postal">
      <WorkerSendPostalContent />
    </WorkerLayout>
  );
}
