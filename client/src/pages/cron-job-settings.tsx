import { useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Play } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CronJobLayout, useCronJobLayout } from "@/components/layouts/CronJobLayout";

function CronJobSettingsContent() {
  const { name } = useParams<{ name: string }>();
  const { job } = useCronJobLayout();
  const { toast } = useToast();

  const runMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/cron-jobs/${encodeURIComponent(name!)}/run`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name] });
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name, "runs"] });
      toast({
        title: "Job Started",
        description: "The cron job has been manually triggered.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Run Job",
        description: error.message || "Failed to trigger the cron job",
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (isEnabled: boolean) => {
      return await apiRequest("PATCH", `/api/cron-jobs/${encodeURIComponent(name!)}`, { isEnabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name] });
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs"] });
      toast({
        title: "Job Updated",
        description: "Cron job status has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Job",
        description: error.message || "Failed to update cron job",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Settings</CardTitle>
        <CardDescription>Configure and manage this cron job</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Enable Job</p>
            <p className="text-sm text-muted-foreground">
              Allow this job to run on its schedule
            </p>
          </div>
          <Switch
            checked={job.isEnabled}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            disabled={toggleMutation.isPending}
            data-testid="switch-enabled"
          />
        </div>
        <div className="pt-6 border-t">
          <p className="font-medium mb-2">Manual Execution</p>
          <p className="text-sm text-muted-foreground mb-4">
            Trigger this job to run immediately, regardless of schedule
          </p>
          <Button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            data-testid="button-run-now"
          >
            <Play className="h-4 w-4 mr-2" />
            Run Now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CronJobSettings() {
  return (
    <CronJobLayout activeTab="settings">
      <CronJobSettingsContent />
    </CronJobLayout>
  );
}
