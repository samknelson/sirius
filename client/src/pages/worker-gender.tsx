import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import GenderManagement from "@/components/worker/GenderManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function WorkerGenderContent() {
  const { worker } = useWorkerLayout();
  const { canAccess: canEdit } = useAccessCheck('worker.edit', worker.id);

  return (
    <Card>
      <CardContent>
        <GenderManagement contactId={worker.contactId} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

export default function WorkerGender() {
  return (
    <WorkerLayout activeTab="gender">
      <WorkerGenderContent />
    </WorkerLayout>
  );
}
