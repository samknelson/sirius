import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import AddressManagement from "@/components/worker/AddressManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function WorkerAddressesContent() {
  const { worker } = useWorkerLayout();
  const { canAccess: canEdit } = useAccessCheck("contact.edit", worker.contactId);

  return (
    <Card>
      <CardContent>
        <AddressManagement workerId={worker.id} contactId={worker.contactId} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

export default function WorkerAddresses() {
  return (
    <WorkerLayout activeTab="addresses">
      <WorkerAddressesContent />
    </WorkerLayout>
  );
}
