import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { ActivityLogView } from "@/components/shared";

function EmployerLogsContent() {
  const { employer } = useEmployerLayout();

  return <ActivityLogView hostEntityId={employer.id} title="Activity Logs" />;
}

export default function EmployerLogsPage() {
  return (
    <EmployerLayout activeTab="logs">
      <EmployerLogsContent />
    </EmployerLayout>
  );
}
