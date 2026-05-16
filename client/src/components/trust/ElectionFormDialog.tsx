import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ElectionForm } from "@/components/trust/ElectionForm";
import type { WorkerTrustElection } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  workerId: string;
  election?: WorkerTrustElection | null;
  onSaved?: (saved: WorkerTrustElection) => void;
}

export function ElectionFormDialog({ open, onOpenChange, mode, workerId, election, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Trust Election" : "Edit Trust Election"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Creating a new active election will end-date the worker's previous active election."
              : "Update this election. The worker cannot be changed."}
          </DialogDescription>
        </DialogHeader>

        <ElectionForm
          mode={mode}
          workerId={workerId}
          election={election}
          enabled={open}
          onSaved={(saved) => {
            onSaved?.(saved);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
