import { CompanyLayout, useCompanyLayout } from "@/components/layouts/CompanyLayout";
import { ActivityLogView } from "@/components/shared";

function CompanyLogsContent() {
  const { company } = useCompanyLayout();

  return <ActivityLogView hostEntityId={company.id} title="Activity Logs" />;
}

export default function CompanyLogsPage() {
  return (
    <CompanyLayout activeTab="logs">
      <CompanyLogsContent />
    </CompanyLayout>
  );
}
