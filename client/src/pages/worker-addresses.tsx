import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import AddressManagement from "@/components/worker/AddressManagement";

function WorkerAddressesContent() {
  const { worker } = useWorkerLayout();

  return (
    <Card>
      <CardContent>
        <AddressManagement workerId={worker.id} contactId={worker.contactId} />
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
