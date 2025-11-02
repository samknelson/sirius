import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import IDsManagement from "@/components/worker/IDsManagement";

function WorkerIDsContent() {
  const { worker } = useWorkerLayout();

  return (
    <Card>
      <CardContent>
        <IDsManagement workerId={worker.id} />
      </CardContent>
    </Card>
  );
}

export default function WorkerIDs() {
  return (
    <WorkerLayout activeTab="ids">
      <WorkerIDsContent />
    </WorkerLayout>
  );
}
