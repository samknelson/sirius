import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerSendSmsContent() {
  const { worker, contact } = useWorkerLayout();
  return <CommSendWrapper channel="sms" contact={contact} composeTarget={{ scope: "worker", recordId: worker.id }} />;
}

export default function WorkerSendSms() {
  return (
    <WorkerLayout activeTab="send-sms">
      <WorkerSendSmsContent />
    </WorkerLayout>
  );
}
