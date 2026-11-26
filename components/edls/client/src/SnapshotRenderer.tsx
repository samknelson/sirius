import type { SnapshotRendererProps } from "@/components/snapshots/renderers";
import { SheetDetailsView, type EdlsCrewWithRelations, type AssignmentWithWorker } from "./components/edls/SheetDetailsView";

export default function SnapshotRenderer({ decoded }: SnapshotRendererProps) {
  const { sheet, crews, assignments } = decoded as {
    sheet: Record<string, any>;
    crews: EdlsCrewWithRelations[];
    assignments: AssignmentWithWorker[];
  };
  return <SheetDetailsView sheet={sheet} crews={crews} assignments={assignments} snapshotMode />;
}
