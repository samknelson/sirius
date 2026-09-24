import { useParams } from "wouter";
import { GrievanceLayout } from "@/components/layouts/GrievanceLayout";
import { EntityFileManager } from "@/components/entity-files/EntityFileManager";

export default function GrievanceFilesPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <GrievanceLayout activeTab="files">
      {id ? <EntityFileManager context="grievance" entityId={id} /> : null}
    </GrievanceLayout>
  );
}
