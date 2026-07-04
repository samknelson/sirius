import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import { ActivityLogView } from "@/components/shared";

function GrievanceLogsContent() {
  const { grievance } = useGrievanceLayout();
  return <ActivityLogView hostEntityId={grievance.id} title="Activity Logs" />;
}

export default function GrievanceLogs() {
  return (
    <GrievanceLayout activeTab="logs">
      <GrievanceLogsContent />
    </GrievanceLayout>
  );
}
