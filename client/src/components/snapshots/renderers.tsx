import type { ComponentType } from "react";
import {
  SheetDetailsView,
  type EdlsCrewWithRelations,
  type AssignmentWithWorker,
} from "@/components/edls/SheetDetailsView";

export interface SnapshotRendererProps {
  /** Decoded snapshot payload as returned by the snapshot GET endpoint. */
  decoded: unknown;
}

/**
 * Client-side snapshot renderer registry, keyed by entity type. Each
 * renderer receives the decoded snapshot (already in the live GET endpoint
 * shape for its entity type) and renders it read-only. Unregistered types
 * fall back to a raw JSON view in the browser.
 */
const renderers: Record<string, ComponentType<SnapshotRendererProps>> = {
  edls_sheet: EdlsSheetSnapshotRenderer,
};

function EdlsSheetSnapshotRenderer({ decoded }: SnapshotRendererProps) {
  const { sheet, crews, assignments } = decoded as {
    sheet: Record<string, any>;
    crews: EdlsCrewWithRelations[];
    assignments: AssignmentWithWorker[];
  };
  return (
    <SheetDetailsView
      sheet={sheet}
      crews={crews}
      assignments={assignments}
      snapshotMode
    />
  );
}

export function getSnapshotRenderer(entityType: string): ComponentType<SnapshotRendererProps> | undefined {
  return renderers[entityType];
}
