import { FacilityLayout, useFacilityLayout } from "@/components/layouts/FacilityLayout";
import { ActivityLogView } from "@/components/shared";

function LogsContent() {
  const { facility } = useFacilityLayout();
  return (
    <ActivityLogView
      hostEntityId={facility.id}
      title="Activity Logs"
      endpoint={`/api/facilities/${facility.id}/logs`}
    />
  );
}

export default function FacilityLogsPage() {
  return (
    <FacilityLayout activeTab="logs">
      <LogsContent />
    </FacilityLayout>
  );
}
