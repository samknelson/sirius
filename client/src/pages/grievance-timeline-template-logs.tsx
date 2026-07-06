import {
  GrievanceTimelineTemplateLayout,
  useGrievanceTimelineTemplateLayout,
} from "@/components/layouts/GrievanceTimelineTemplateLayout";
import { ActivityLogView } from "@/components/shared";

function LogsContent() {
  const { template } = useGrievanceTimelineTemplateLayout();
  return <ActivityLogView hostEntityId={template.id} title="Activity Logs" />;
}

export default function GrievanceTimelineTemplateLogs() {
  return (
    <GrievanceTimelineTemplateLayout activeTab="logs">
      <LogsContent />
    </GrievanceTimelineTemplateLayout>
  );
}
