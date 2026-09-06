import { format } from "@/lib/date-format";
import type { RecordMetadataStamp } from "./RecordHistoryDialog";

interface RecordCreatedStampProps {
  /** The record's created stamp, as its history reports it. */
  stamp: RecordMetadataStamp | null | undefined;
  testId?: string;
}

/**
 * When a record was created and by whom, inline — a table cell or a field on a
 * detail page, rather than the dialog behind {@link RecordMetadataBadge}.
 *
 * This is the same fact and the same wording as the history dialog, for the
 * screens that used to show a creation date the record's own table kept. Now
 * that provenance is the only place that date lives, it also knows the person,
 * which the retired columns never did — so both are shown together.
 *
 * A record with nothing recorded shows an em dash. That is the ordinary state
 * of a record made before its table came under this bookkeeping, not an error,
 * and it is deliberately not dressed up as one.
 */
export function RecordCreatedStamp({ stamp, testId }: RecordCreatedStampProps) {
  if (!stamp?.date) {
    return (
      <span className="text-muted-foreground" data-testid={testId}>
        —
      </span>
    );
  }
  return (
    <span data-testid={testId}>
      <span>{format(new Date(stamp.date), "MMM d, yyyy h:mm a")}</span>
      <span className="block text-muted-foreground">
        {stamp.personName ?? "person not recorded"}
      </span>
    </span>
  );
}
