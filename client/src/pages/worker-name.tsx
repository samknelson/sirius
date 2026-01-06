import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import NameManagement from "@/components/worker/NameManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function WorkerNameContent() {
  const { worker } = useWorkerLayout();
  const { canAccess: canEdit } = useAccessCheck('worker.edit', worker.id);

  return (
    <Card>
      <CardContent>
        <NameManagement workerId={worker.id} contactId={worker.contactId} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

export default function WorkerName() {
  return (
    <WorkerLayout activeTab="name">
      <WorkerNameContent />
    </WorkerLayout>
  );
}
