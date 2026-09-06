import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import EntityNotesPanel from "@/components/entity-notes/EntityNotesPanel";

function EmployerNotesContent() {
  const { employer } = useEmployerLayout();
  return <EntityNotesPanel contextId="employer" entityId={employer.id} />;
}

export default function EmployerNotesPage() {
  return (
    <EmployerLayout activeTab="notes">
      <EmployerNotesContent />
    </EmployerLayout>
  );
}
