import { Badge } from "@/components/ui/badge";
import type { SnapshotRevision as SnapshotRevisionValue } from "@shared/snapshots";
import {
  formatRecordRevision,
  formatRecordSequence,
} from "@shared/utils/record-sequence";

export function formatSnapshotRevision(revision: SnapshotRevisionValue | null): string {
  return revision
    ? `${formatRecordSequence(revision.seq)}::${formatRecordRevision(revision.rev)}`
    : "Revision not recorded";
}

export function SnapshotRevision({
  revision,
  testId,
}: {
  revision: SnapshotRevisionValue | null;
  testId: string;
}) {
  return (
    <Badge
      variant="outline"
      className="font-mono text-xs text-muted-foreground"
      data-testid={testId}
    >
      {formatSnapshotRevision(revision)}
    </Badge>
  );
}