import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { EntityFileManager } from "@/components/entity-files/EntityFileManager";

function WorkerFilesContent() {
  const { worker } = useWorkerLayout();
  return <EntityFileManager context="worker" entityId={worker.id} />;
}

export default function WorkerFilesPage() {
  return (
    <WorkerLayout activeTab="files">
      <WorkerFilesContent />
    </WorkerLayout>
  );
}
