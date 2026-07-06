import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import { Worker } from "@shared/schema";

interface DeleteWorkerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: Worker | null;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteWorkerModal({
  open,
  onOpenChange,
  worker,
  onConfirm,
  isDeleting,
}: DeleteWorkerModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center space-x-3 mb-2">
            <div className="w-10 h-10 bg-destructive/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="text-destructive" size={20} />
            </div>
            <div>
              <AlertDialogTitle>Delete Worker</AlertDialogTitle>
              <p className="text-muted-foreground text-sm">This action cannot be undone</p>
            </div>
          </div>
          <AlertDialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-medium" data-testid="text-delete-worker-name">
              {worker?.siriusId ? `Worker #${worker.siriusId}` : "this worker"}
            </span>
            ? This will permanently remove the worker from your database.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isDeleting}
            data-testid="button-confirm-delete"
          >
            {isDeleting ? "Deleting..." : "Delete Worker"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
