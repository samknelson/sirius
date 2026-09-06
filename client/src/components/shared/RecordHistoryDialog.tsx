import { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "@/lib/date-format";
import { useToast } from "@/hooks/use-toast";
import {
  formatRecordRevision,
  formatRecordSequence,
} from "@shared/utils/record-sequence";

/** One date/person pair as a record's history reports it. */
export interface RecordMetadataStamp {
  date: string | null;
  personName: string | null;
}

/** What the system knows about how one record came to be as it is. */
export interface RecordMetadata {
  seq: number;
  rev: number;
  contextId: string;
  entityId: string;
  created: RecordMetadataStamp;
  modified: RecordMetadataStamp;
  subrecordModified: RecordMetadataStamp;
}

/**
 * What the caller has to show. A record with no history is `ready` with
 * nothing in it, which is an answer — every record that predates this
 * bookkeeping reads that way — and not the same as not having asked yet.
 */
export type RecordHistoryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; metadata: RecordMetadata | null };

interface RecordHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: RecordHistoryState;
}

/**
 * A record's history, in a dialog.
 *
 * Two places open this: the badge in the corner of the record's own page, and
 * the administrator's list of every provenance row in the system. They arrive
 * at it differently — the badge asks the server for one record, the list
 * already holds the row it is showing — so this component is handed the
 * answer rather than fetching one. That is what keeps the two the same
 * dialog: the only thing they can differ in is where the facts came from.
 *
 * Nothing here is editable, in either caller. The system writes a record's
 * history as it writes the record; there is no form behind this and no
 * endpoint to change what it shows.
 */
export function RecordHistoryDialog({
  open,
  onOpenChange,
  state,
}: RecordHistoryDialogProps) {
  const { toast } = useToast();
  const [copiedEntityId, setCopiedEntityId] = useState(false);
  const metadata = state.status === "ready" ? state.metadata : null;

  const copyEntityId = async (entityId: string) => {
    try {
      await navigator.clipboard.writeText(entityId);
      setCopiedEntityId(true);
      setTimeout(() => setCopiedEntityId(false), 2000);
      toast({
        title: "Copied",
        description: "The entity UUID is on your clipboard.",
      });
    } catch {
      setCopiedEntityId(false);
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access — select the UUID and copy it manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        There is no description to give: the dialog is its own explanation.
        The dialog primitive warns about a missing description unless the
        caller says so on purpose, which is what the undefined below is.
      */}
      <DialogContent
        className="max-w-md"
        aria-describedby={undefined}
        data-testid="dialog-record-metadata"
      >
        <DialogHeader>
          <DialogTitle>Record history</DialogTitle>
        </DialogHeader>

        {state.status === "loading" ? (
          <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-loading">
            Loading…
          </p>
        ) : state.status === "error" ? (
          <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-error">
            This record's history could not be read.
          </p>
        ) : !metadata ? (
          <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-empty">
            No data
          </p>
        ) : (
          <dl className="space-y-3 text-sm">
            <StampRow label="Created" stamp={metadata.created} testId="created" />
            <StampRow label="Last modified" stamp={metadata.modified} testId="modified" />
            <StampRow
              label="Sub-record modified"
              stamp={metadata.subrecordModified}
              testId="subrecord"
            />
            <div className="flex items-baseline justify-between gap-4 pt-2 border-t border-border">
              <dt className="text-muted-foreground">Sequence</dt>
              <dd className="font-mono" data-testid="text-record-metadata-seq">
                {formatRecordSequence(metadata.seq)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Revision</dt>
              <dd className="font-mono" data-testid="text-record-metadata-rev">
                {formatRecordRevision(metadata.rev)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Entity UUID</dt>
              <dd
                className="flex min-w-0 items-start justify-end gap-2 font-mono"
                data-testid="text-record-metadata-entity-id"
              >
                <span className="break-all text-right">{metadata.entityId}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => void copyEntityId(metadata.entityId)}
                  aria-label={copiedEntityId ? "Entity UUID copied" : "Copy entity UUID"}
                  title={copiedEntityId ? "Entity UUID copied" : "Copy entity UUID"}
                  data-testid="button-copy-record-metadata-entity-id"
                >
                  {copiedEntityId ? <Check /> : <Copy />}
                </Button>
              </dd>
            </div>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StampRow({
  label,
  stamp,
  testId,
}: {
  label: string;
  stamp: RecordMetadataStamp;
  testId: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right" data-testid={`text-record-metadata-${testId}`}>
        {stamp.date ? (
          <>
            <span>{format(new Date(stamp.date), "MMM d, yyyy h:mm a")}</span>
            <span className="block text-muted-foreground">
              {stamp.personName ?? "person not recorded"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Never</span>
        )}
      </dd>
    </div>
  );
}
