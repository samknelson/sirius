import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { SnapshotBrowser } from "@/components/snapshots/SnapshotBrowser";

function EdlsSheetSnapshotsContent() {
  const { sheet } = useEdlsSheetLayout();

  return <SnapshotBrowser entityType="edls_sheet" entityId={sheet.id} />;
}

export default function EdlsSheetSnapshotsPage() {
  return (
    <EdlsSheetLayout activeTab="snapshots">
      <EdlsSheetSnapshotsContent />
    </EdlsSheetLayout>
  );
}
