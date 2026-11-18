import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import AddressManagement from "@/components/worker/AddressManagement";
import { useAccessCheck } from "@/hooks/use-access-check";
import { useAuth } from "@/contexts/AuthContext";

function WorkerAddressesContent() {
  const { worker } = useWorkerLayout();
  const { user } = useAuth();
  const { canAccess: canEdit } = useAccessCheck("contact.edit", worker.contactId);

  return (
    <Card>
      <CardContent>
        <AddressManagement workerId={worker.id} contactId={worker.contactId} canEdit={canEdit} selfService={user?.workerId === worker.id} />
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
