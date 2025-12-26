import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommList } from "@/components/worker/CommList";
import { CommWithSms } from "@/lib/comm-types";

function WorkerCommHistoryContent() {
  const { worker } = useWorkerLayout();

  const { data: records = [], isLoading } = useQuery<CommWithSms[]>({
    queryKey: ["/api/contacts", worker.contactId, "comm"],
    enabled: !!worker.contactId,
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <CommList 
          records={records} 
          isLoading={isLoading}
          title="Communication History"
          emptyMessage="No communication history found for this worker."
        />
      </CardContent>
    </Card>
  );
}

export default function WorkerCommHistory() {
  return (
    <WorkerLayout activeTab="comm-history">
      <WorkerCommHistoryContent />
    </WorkerLayout>
  );
}
