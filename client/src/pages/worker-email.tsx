import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import EmailManagement from "@/components/worker/EmailManagement";

function WorkerEmailContent() {
  const { worker } = useWorkerLayout();

  return (
    <Card>
      <CardContent>
        <EmailManagement contactId={worker.contactId} />
      </CardContent>
    </Card>
  );
}

export default function WorkerEmail() {
  return (
    <WorkerLayout activeTab="email">
      <WorkerEmailContent />
    </WorkerLayout>
  );
}
