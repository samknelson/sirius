import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import NotesPanel from "@/components/notes/NotesPanel";

function GrievanceNotesContent() {
  const { grievance } = useGrievanceLayout();
  return <NotesPanel entityType="grievance" entityId={grievance.id} />;
}

export default function GrievanceNotes() {
  return (
    <GrievanceLayout activeTab="notes">
      <GrievanceNotesContent />
    </GrievanceLayout>
  );
}
