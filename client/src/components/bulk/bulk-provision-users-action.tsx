import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ListChecks, UserPlus } from "lucide-react";

type BulkStatus = "created" | "enabled" | "skipped_no_email" | "conflict" | "error";

interface ProvisionResult {
  contactId: string;
  contactName: string | null;
  status: BulkStatus;
  message?: string;
}

interface ProvisionResponse {
  results: ProvisionResult[];
  summary: {
    created: number;
    enabled: number;
    skippedNoEmail: number;
    conflict: number;
    error: number;
  };
}

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

const STATUS_LABELS: Record<BulkStatus, string> = {
  created: "Created",
  enabled: "Enabled",
  skipped_no_email: "Skipped (no email)",
  conflict: "Conflict",
  error: "Error",
};

const STATUS_CLASSES: Record<BulkStatus, string> = {
  created: "text-green-600 dark:text-green-400",
  enabled: "text-green-600 dark:text-green-400",
  skipped_no_email: "text-muted-foreground",
  conflict: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

interface BulkProvisionUsersActionProps {
  selectedContactIds: string[];
  totalMatching: number;
  visibleSelectedCount: number;
  onSelectAllMatching: () => void;
  isSelectingAllMatching?: boolean;
  onCompleted?: () => void;
}

export function BulkProvisionUsersAction({
  selectedContactIds,
  totalMatching,
  visibleSelectedCount,
  onSelectAllMatching,
  isSelectingAllMatching = false,
  onCompleted,
}: BulkProvisionUsersActionProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [response, setResponse] = useState<ProvisionResponse | null>(null);

  // Mirror ListBulkAction's gating so we never render a second "Select all matching"
  // button when bulk messaging is enabled (it already provides one).
  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });
  const bulkEnabled = componentConfig.find((c) => c.componentId === "bulk")?.enabled ?? false;

  const selectionCount = selectedContactIds.length;
  const noSelection = selectionCount === 0;
  const allMatchingSelected = totalMatching > 0 && selectionCount >= totalMatching;
  const showSelectAll = !bulkEnabled && totalMatching > visibleSelectedCount && !allMatchingSelected;

  const mutation = useMutation<ProvisionResponse, Error, void>({
    mutationFn: async () => {
      return apiRequest("POST", "/api/employer-contacts/bulk-provision-users", {
        contactIds: selectedContactIds,
      });
    },
    onSuccess: (result) => {
      setConfirmOpen(false);
      setResponse(result);
      setResultsOpen(true);
      const { created, enabled, skippedNoEmail, conflict, error } = result.summary;
      toast({
        title: "Bulk user provisioning complete",
        description: `${created} created, ${enabled} enabled, ${skippedNoEmail} skipped, ${conflict} conflict${conflict === 1 ? "" : "s"}, ${error} error${error === 1 ? "" : "s"}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employers/contact-indicators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employer-contacts"] });
      onCompleted?.();
    },
    onError: (error) => {
      toast({
        title: "Failed to provision users",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="bulk-provision-users-container">
      {showSelectAll && (
        <Button
          variant="outline"
          size="sm"
          onClick={onSelectAllMatching}
          disabled={isSelectingAllMatching}
          data-testid="bulk-provision-users-select-all-matching"
        >
          {isSelectingAllMatching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ListChecks className="mr-2 h-4 w-4" />
          )}
          Select all {totalMatching.toLocaleString()} matching
        </Button>
      )}
      <Button
        variant="default"
        size="sm"
        disabled={noSelection || mutation.isPending}
        onClick={() => setConfirmOpen(true)}
        data-testid="bulk-provision-users-trigger"
      >
        {mutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <UserPlus className="mr-2 h-4 w-4" />
        )}
        Create / enable users{noSelection ? "" : ` (${selectionCount})`}
      </Button>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!mutation.isPending) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent data-testid="bulk-provision-users-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Create or enable user accounts?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div data-testid="bulk-provision-users-confirm-summary">
                  This will create new user accounts (or re-enable existing ones) for{" "}
                  <span className="font-semibold text-foreground">
                    {selectionCount.toLocaleString()} contact{selectionCount === 1 ? "" : "s"}
                  </span>
                  . Contacts without an email address are skipped.
                </div>
                <div className="text-xs">
                  New accounts are provisioned in Clerk and processed one at a time, so this may
                  take a moment for large selections.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending} data-testid="bulk-provision-users-confirm-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
              data-testid="bulk-provision-users-confirm-run"
            >
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create / enable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
        <DialogContent className="max-w-lg" data-testid="bulk-provision-users-results-dialog">
          <DialogHeader>
            <DialogTitle>User provisioning results</DialogTitle>
            <DialogDescription>
              {response && (
                <span data-testid="bulk-provision-users-results-summary">
                  {response.summary.created} created, {response.summary.enabled} enabled,{" "}
                  {response.summary.skippedNoEmail} skipped, {response.summary.conflict} conflict
                  {response.summary.conflict === 1 ? "" : "s"}, {response.summary.error} error
                  {response.summary.error === 1 ? "" : "s"}.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
            {response?.results.map((r) => (
              <div
                key={r.contactId}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                data-testid={`bulk-provision-users-result-${r.contactId}`}
              >
                <span className="truncate">{r.contactName || "Unnamed contact"}</span>
                <span className={`whitespace-nowrap font-medium ${STATUS_CLASSES[r.status]}`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResultsOpen(false)} data-testid="bulk-provision-users-results-close">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
