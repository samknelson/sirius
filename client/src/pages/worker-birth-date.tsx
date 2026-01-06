import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import BirthDateManagement from "@/components/worker/BirthDateManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function WorkerBirthDateContent() {
  const { worker } = useWorkerLayout();
  const { canAccess: canEdit } = useAccessCheck('worker.edit', worker.id);

  return (
    <Card>
      <CardContent>
        <BirthDateManagement contactId={worker.contactId} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

export default function WorkerBirthDate() {
  return (
    <WorkerLayout activeTab="birth-date">
      <WorkerBirthDateContent />
    </WorkerLayout>
  );
}
