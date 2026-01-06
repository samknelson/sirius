import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { PhoneNumberManagement } from "@/components/worker/PhoneNumberManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function WorkerPhoneNumbersContent() {
  const { worker } = useWorkerLayout();
  const { canAccess: canEdit } = useAccessCheck("contact.edit", worker.contactId);

  return (
    <Card>
      <CardContent>
        <PhoneNumberManagement contactId={worker.contactId} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

export default function WorkerPhoneNumbers() {
  return (
    <WorkerLayout activeTab="phone-numbers">
      <WorkerPhoneNumbersContent />
    </WorkerLayout>
  );
}
