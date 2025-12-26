import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function WorkerSendSmsContent() {
  const { contact } = useWorkerLayout();
  return <CommSendWrapper channel="sms" contact={contact} />;
}

export default function WorkerSendSms() {
  return (
    <WorkerLayout activeTab="send-sms">
      <WorkerSendSmsContent />
    </WorkerLayout>
  );
}
