import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import NotesPanel from "@/components/notes/NotesPanel";

function WorkerNotesContent() {
  const { worker } = useWorkerLayout();
  return <NotesPanel entityType="worker" entityId={worker.id} />;
}

export default function WorkerNotesPage() {
  return (
    <WorkerLayout activeTab="notes">
      <WorkerNotesContent />
    </WorkerLayout>
  );
}
