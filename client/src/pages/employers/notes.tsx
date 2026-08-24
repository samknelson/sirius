import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import NotesPanel from "@/components/notes/NotesPanel";

function EmployerNotesContent() {
  const { employer } = useEmployerLayout();
  return <NotesPanel entityType="employer" entityId={employer.id} />;
}

export default function EmployerNotesPage() {
  return (
    <EmployerLayout activeTab="notes">
      <EmployerNotesContent />
    </EmployerLayout>
  );
}
