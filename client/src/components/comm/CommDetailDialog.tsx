import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useModalSeed } from "@/hooks/use-modal-seed";
import { CommDetailContent } from "@/components/comm/CommDetailContent";

export interface CommDetailDialogProps {
  /** Communication record to show while the dialog is open. */
  commId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional line under the title naming who the message was for. */
  description?: string;
  "data-testid"?: string;
}

/**
 * Read-only communication record in a dialog, for surfaces that link a
 * communication (an EDLS assignment, say) and want to inspect its delivery
 * without leaving the page.
 *
 * The record is fetched only while the dialog is open: the body — and the
 * queries inside it — mount with the dialog content and unmount when it
 * closes.
 */
export function CommDetailDialog({
  commId,
  open,
  onOpenChange,
  description,
  "data-testid": testId = "dialog-comm-detail",
}: CommDetailDialogProps) {
  // Which record this opening is for. Seeded during the render that opens the
  // dialog so the body's first render is already keyed to the right comm,
  // never to the one the previous opening showed.
  const [activeCommId, setActiveCommId] = useState<string | null>(null);
  useModalSeed(open, commId, () => setActiveCommId(commId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>Communication</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {activeCommId && <CommDetailContent commId={activeCommId} />}
      </DialogContent>
    </Dialog>
  );
}
