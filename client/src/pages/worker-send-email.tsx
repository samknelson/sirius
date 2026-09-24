import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerSendEmailContent() {
  const { worker, contact } = useWorkerLayout();
  return <CommSendWrapper channel="email" contact={contact} composeTarget={{ scope: "worker", recordId: worker.id }} />;
}

export default function WorkerSendEmail() {
  return (
    <WorkerLayout activeTab="send-email">
      <WorkerSendEmailContent />
    </WorkerLayout>
  );
}
