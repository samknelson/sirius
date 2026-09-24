import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { EntityFileManager } from "@/components/entity-files/EntityFileManager";

function EmployerFilesContent() {
  const { employer } = useEmployerLayout();
  return <EntityFileManager context="employer" entityId={employer.id} />;
}

export default function EmployerFilesPage() {
  return (
    <EmployerLayout activeTab="files">
      <EmployerFilesContent />
    </EmployerLayout>
  );
}
