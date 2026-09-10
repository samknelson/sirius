import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatRecordRevision,
  formatRecordSequence,
} from "@shared/utils/record-sequence";
import { useRecordMetadata } from "@/hooks/useRecordMetadata";
import { RecordHistoryDialog } from "./RecordHistoryDialog";

interface RecordMetadataBadgeProps {
  /** The record's own id. Anything else renders nothing. */
  entityId: string | null | undefined;
}

/**
 * A record's history, in the corner of the page that shows the record.
 *
 * The badge reads the record's sequence number — the one permanent name the
 * system has for it — and opens what little else it knows: when the record was
 * created, when it last changed, and when something hanging off it last
 * changed, each with the person responsible.
 *
 * The dialog itself is {@link RecordHistoryDialog}, shared with the
 * administrator's list of every record's history, so the two cannot drift into
 * showing the same facts differently. What this component owns is the badge
 * and the lookup behind it.
 *
 * None of it is editable, here or anywhere. The system writes a record's
 * history as it writes the record; there is no form behind this dialog and no
 * endpoint to change what it shows.
 *
 * Records that predate this bookkeeping have nothing recorded and show a muted
 * placeholder until something touches them. That is the ordinary case today,
 * not an error.
 */
export function RecordMetadataBadge({ entityId }: RecordMetadataBadgeProps) {
  const [open, setOpen] = useState(false);
  const { isRecordId, metadata, state, refetch, canViewMetadata } = useRecordMetadata(entityId);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Read again every time someone actually looks. This is the moment the
    // answer has to be current, and the only moment we know it is wanted.
    if (next) refetch();
  }

  // A page whose record is still loading, or whose id is not a record id at
  // all, has nothing to ask about.
  if (!canViewMetadata || !isRecordId) return null;

  const label = metadata
    ? `${formatRecordSequence(metadata.seq)}::${formatRecordRevision(metadata.rev)}`
    : "—";

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={`gap-1.5 font-mono text-xs ${metadata ? "text-muted-foreground" : "text-muted-foreground/60"}`}
        onClick={() => handleOpenChange(true)}
        title="Record history"
        aria-label="Record history"
        data-testid="button-record-metadata"
      >
        <History className="h-3.5 w-3.5" />
        {label}
      </Button>

      <RecordHistoryDialog open={open} onOpenChange={handleOpenChange} state={state} />
    </>
  );
}
