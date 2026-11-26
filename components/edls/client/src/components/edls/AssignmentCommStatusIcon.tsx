import { useState } from "react";
import { Mail } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommViewAccess } from "@/hooks/use-comm-view-access";
import { CommDetailDialog } from "@/components/comm/CommDetailDialog";
import { getCommStatusBucket, getCommStatusLabel, type CommStatusBucket } from "@shared/commStatus";

const bucketColors: Record<CommStatusBucket, string> = {
  pending: "text-muted-foreground",
  success: "text-green-600 dark:text-green-500",
  error: "text-red-600 dark:text-red-500",
};

export interface AssignmentCommStatusIconProps {
  /** Assignment the communication belongs to; used for test ids. */
  assignmentId: string;
  /** Communication linked to the assignment. */
  commId: string;
  /** That communication's status, as returned with the assignment. */
  commStatus: string;
  /** Worker name, shown in the dialog so it is clear whose message this is. */
  workerName: string;
}

/**
 * Delivery indicator for the communication linked to an EDLS assignment:
 * an envelope coloured by the shared status bucket, with the status label on
 * hover.
 *
 * Click-through uses the same comm-ID policy as the record/history APIs.
 * Denied users retain the delivery indicator without a clickable action.
 */
export function AssignmentCommStatusIcon({
  assignmentId,
  commId,
  commStatus,
  workerName,
}: AssignmentCommStatusIconProps) {
  const access = useCommViewAccess(commId);
  const canView = access.canView;
  const [isOpen, setIsOpen] = useState(false);

  const label = getCommStatusLabel(commStatus);
  const iconClass = `h-4 w-4 shrink-0 ${bucketColors[getCommStatusBucket(commStatus)]}`;
  const ariaLabel = `Notification ${label}`;
  const testId = `icon-comm-status-${assignmentId}`;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          {canView ? (
            <button
              type="button"
              className="inline-flex items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={access.isFetching}
              onClick={async () => {
                const result = await access.refetch();
                if (result.isSuccess && result.data.granted) setIsOpen(true);
              }}
              aria-label={`${ariaLabel} — view communication`}
              data-testid={testId}
            >
              <Mail className={iconClass} aria-hidden="true" />
            </button>
          ) : (
            <span
              tabIndex={0}
              className="inline-flex items-center"
              aria-label={ariaLabel}
              data-testid={testId}
            >
              <Mail className={iconClass} aria-hidden="true" />
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {canView && (
        <CommDetailDialog
          key={access.viewerKey}
          commId={commId}
          open={isOpen}
          onOpenChange={setIsOpen}
          description={workerName}
          data-testid={`dialog-comm-detail-${assignmentId}`}
        />
      )}
    </>
  );
}
