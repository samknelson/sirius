import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Play, Square, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

function DispatchJobRunContent() {
  const { job } = useDispatchJobLayout();
  const { toast } = useToast();
  const [pendingRunning, setPendingRunning] = useState<boolean>(job.running);
  const hasChanges = pendingRunning !== job.running;

  const updateRunningMutation = useMutation({
    mutationFn: async (running: boolean) => {
      return apiRequest("PATCH", `/api/dispatch-jobs/${job.id}/running`, { running });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs", job.id] });
      toast({
        title: pendingRunning ? "Job Started" : "Job Stopped",
        description: pendingRunning
          ? "The dispatch job is now running."
          : "The dispatch job has been stopped.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update job status",
        variant: "destructive",
      });
      setPendingRunning(job.running);
    },
  });

  const handleSave = () => {
    updateRunningMutation.mutate(pendingRunning);
  };

  const handleCancel = () => {
    setPendingRunning(job.running);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" data-testid="title-run">
          {job.running ? (
            <Play className="h-5 w-5 text-green-500" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground" />
          )}
          Run Job
        </CardTitle>
        <CardDescription>
          Control whether this dispatch job is currently running. Toggle the switch and click Save to apply changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-1">
            <Label htmlFor="running-switch" className="text-base font-medium">
              Job Running Status
            </Label>
            <p className="text-sm text-muted-foreground">
              {pendingRunning
                ? "Job is set to running. Workers can be actively dispatched."
                : "Job is stopped. No active dispatching."}
            </p>
          </div>
          <Switch
            id="running-switch"
            checked={pendingRunning}
            onCheckedChange={setPendingRunning}
            disabled={updateRunningMutation.isPending}
            data-testid="switch-running"
          />
        </div>

        <div className="flex items-center gap-2 pt-4 border-t">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateRunningMutation.isPending}
            data-testid="button-save"
          >
            {updateRunningMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={!hasChanges || updateRunningMutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
        </div>

        {hasChanges && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            You have unsaved changes. Click Save to apply.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DispatchJobRunPage() {
  return (
    <DispatchJobLayout activeTab="run">
      <DispatchJobRunContent />
    </DispatchJobLayout>
  );
}
