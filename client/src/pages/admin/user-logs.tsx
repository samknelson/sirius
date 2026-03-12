import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { ActivityLogView } from "@/components/shared";

function UserLogsContent() {
  const { user } = useUserLayout();

  return <ActivityLogView hostEntityId={user.id} title="Activity Logs" />;
}

export default function UserLogsPage() {
  return (
    <UserLayout activeTab="logs">
      <UserLogsContent />
    </UserLayout>
  );
}
