import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { PhoneNumberManagement } from "@/components/worker/PhoneNumberManagement";

function WorkerPhoneNumbersContent() {
  const { worker } = useWorkerLayout();

  return (
    <Card>
      <CardContent>
        <PhoneNumberManagement contactId={worker.contactId} />
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
