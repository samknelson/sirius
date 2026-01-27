import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { ActivityLogView } from "@/components/shared";

function EdlsSheetLogsContent() {
  const { sheet } = useEdlsSheetLayout();

  return <ActivityLogView hostEntityId={sheet.id} title="Activity Logs" />;
}

export default function EdlsSheetLogsPage() {
  return (
    <EdlsSheetLayout activeTab="logs">
      <EdlsSheetLogsContent />
    </EdlsSheetLayout>
  );
}
