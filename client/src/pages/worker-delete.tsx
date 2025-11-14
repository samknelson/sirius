import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function WorkerDeleteContent() {
  const { worker, contact } = useWorkerLayout();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const deleteWorkerMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/workers/${worker.id}`, {});
      if (!response.ok) {
        throw new Error("Failed to delete worker");
      }
    },
    onSuccess: () => {
      toast({
        title: "Worker Deleted",
        description: "The worker and all associated records have been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      setLocation("/workers");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete worker",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Delete Worker
        </CardTitle>
        <CardDescription>
          Permanently delete this worker and all associated records
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
          <h3 className="font-medium mb-2">This action cannot be undone</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Deleting this worker will:
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
            <li>Permanently delete the worker record (Sirius ID: {worker.siriusId})</li>
            <li>Delete the associated contact record ({contact?.displayName || 'Unknown'})</li>
            <li>Remove all employment history</li>
            <li>Remove all benefit records</li>
            <li>Delete all phone numbers and addresses</li>
            <li>Delete all worker IDs</li>
            <li>This data cannot be recovered</li>
          </ul>
        </div>

        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="destructive" 
                disabled={deleteWorkerMutation.isPending}
                data-testid="button-delete-worker"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {deleteWorkerMutation.isPending ? "Deleting..." : "Delete Worker"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the worker "{contact?.displayName || 'Unknown'}" 
                  (Sirius ID: {worker.siriusId}). 
                  This action cannot be undone and will remove all associated records.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteWorkerMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete"
                >
                  Delete Worker
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkerDelete() {
  return (
    <WorkerLayout activeTab="delete">
      <WorkerDeleteContent />
    </WorkerLayout>
  );
}
