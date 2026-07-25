import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { HardHat, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { DispatchJobForeWithWorker, ForeEligibleWorker } from "../../../../server/storage/dispatch/fore";

function JobForeContent() {
  const { job } = useDispatchJobLayout();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("");
  const [removeTarget, setRemoveTarget] = useState<DispatchJobForeWithWorker | null>(null);

  const listKey = ["/api/dispatch-jobs", job.id, "fore"];

  const { data: forepersons = [], isLoading } = useQuery<DispatchJobForeWithWorker[]>({
    queryKey: listKey,
  });

  const { data: eligibleWorkers = [], isLoading: eligibleLoading } = useQuery<ForeEligibleWorker[]>({
    queryKey: ["/api/dispatch-jobs", job.id, "fore", "eligible"],
    enabled: addOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: listKey });
    queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs", job.id, "fore", "eligible"] });
  };

  const addMutation = useMutation({
    mutationFn: async (workerId: string) => {
      return apiRequest("POST", `/api/dispatch-jobs/${job.id}/fore`, { workerId });
    },
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      setSelectedWorkerId("");
      toast({ title: "Foreperson added" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add Foreperson",
        description: error?.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (foreId: string) => {
      return apiRequest("DELETE", `/api/dispatch-jobs/${job.id}/fore/${foreId}`);
    },
    onSuccess: () => {
      invalidate();
      setRemoveTarget(null);
      toast({ title: "Foreperson removed" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to remove Foreperson",
        description: error?.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5" />
            Forepersons
          </CardTitle>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-foreperson">
            <Plus className="h-4 w-4 mr-2" />
            Add Foreperson
          </Button>
        </CardHeader>
        <CardContent>
          {forepersons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12" data-testid="empty-state-no-forepersons">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <HardHat className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-empty-title">No Forepersons</h3>
              <p className="text-muted-foreground text-center mb-4" data-testid="text-empty-message">
                No Forepersons have been designated for this job yet.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forepersons.map((fore) => (
                  <TableRow key={fore.id} data-testid={`row-foreperson-${fore.id}`}>
                    <TableCell>
                      {fore.worker ? (
                        <Link
                          href={`/workers/${fore.worker.id}`}
                          className="text-primary hover:underline"
                          data-testid={`link-worker-${fore.worker.id}`}
                        >
                          {fore.worker.contact?.displayName || "Unknown Worker"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unknown Worker</span>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-sirius-id-${fore.id}`}>
                      {fore.worker?.siriusId ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRemoveTarget(fore)}
                        data-testid={`button-remove-foreperson-${fore.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setSelectedWorkerId(""); }}>
        <DialogContent data-testid="dialog-add-foreperson">
          <DialogHeader>
            <DialogTitle>Add Foreperson</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Only workers with an accepted primary dispatch at {job.employer?.name || "this job's employer"} are eligible.
            </p>
            {eligibleLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : eligibleWorkers.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-eligible-workers">
                No eligible workers available.
              </p>
            ) : (
              <Select value={selectedWorkerId} onValueChange={setSelectedWorkerId}>
                <SelectTrigger data-testid="select-eligible-worker">
                  <SelectValue placeholder="Select a worker" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleWorkers.map((w) => (
                    <SelectItem key={w.id} value={w.id} data-testid={`option-worker-${w.id}`}>
                      {w.displayName || "Unknown Worker"}{w.siriusId != null ? ` (#${w.siriusId})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button
              onClick={() => selectedWorkerId && addMutation.mutate(selectedWorkerId)}
              disabled={!selectedWorkerId || addMutation.isPending}
              data-testid="button-confirm-add"
            >
              {addMutation.isPending ? "Adding…" : "Add Foreperson"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent data-testid="dialog-remove-foreperson">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Foreperson</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {removeTarget?.worker?.contact?.displayName || "this worker"} as a Foreperson on this job?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
              disabled={removeMutation.isPending}
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function JobForePage() {
  return (
    <DispatchJobLayout activeTab="foreperson">
      <JobForeContent />
    </DispatchJobLayout>
  );
}
