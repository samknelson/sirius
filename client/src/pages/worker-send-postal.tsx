import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerSendPostalContent() {
  const { worker, contact } = useWorkerLayout();
  return <CommSendWrapper channel="postal" contact={contact} composeTarget={{ scope: "worker", recordId: worker.id }} />;
}

export default function WorkerSendPostal() {
  return (
    <WorkerLayout activeTab="send-postal">
      <WorkerSendPostalContent />
    </WorkerLayout>
  );
}
