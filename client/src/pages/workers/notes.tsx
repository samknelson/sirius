import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import EntityNotesPanel from "@/components/entity-notes/EntityNotesPanel";

function WorkerNotesContent() {
  const { worker } = useWorkerLayout();
  return <EntityNotesPanel contextId="worker" entityId={worker.id} />;
}

export default function WorkerNotesPage() {
  return (
    <WorkerLayout activeTab="notes">
      <WorkerNotesContent />
    </WorkerLayout>
  );
}
