import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import EmailManagement from "@/components/worker/EmailManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function WorkerEmailContent() {
  const { worker } = useWorkerLayout();
  // This endpoint intentionally remains staff-only; do not offer self-service
  // just because other contact fields permit it.
  const { canAccess: canEdit } = useAccessCheck("staff", worker.id);

  return (
    <Card>
      <CardContent>
        <EmailManagement contactId={worker.contactId} workerId={worker.id} canEdit={canEdit} />
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
