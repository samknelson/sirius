import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerSendEmailContent() {
  const { contact } = useWorkerLayout();
  return <CommSendWrapper channel="email" contact={contact} />;
}

export default function WorkerSendEmail() {
  return (
    <WorkerLayout activeTab="send-email">
      <WorkerSendEmailContent />
    </WorkerLayout>
  );
}
