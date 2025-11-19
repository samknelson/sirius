import { useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Play, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CronJobLayout, useCronJobLayout } from "@/components/layouts/CronJobLayout";
import { format } from "date-fns";

interface CronJobRun {
  id: string;
  jobName: string;
  status: string;
  mode: string;
  output: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
}

interface CronJobOutputData {
  executionTimeMs: number;
  executionTimeSec: string;
  summary: {
    [key: string]: any;
  };
}

function CronJobSettingsContent() {
  const { name } = useParams<{ name: string }>();
  const { job } = useCronJobLayout();
  const { toast } = useToast();
  const [runMode, setRunMode] = useState<"live" | "test">("live");
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);
  const [completedRun, setCompletedRun] = useState<CronJobRun | null>(null);

  const runMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/cron-jobs/${encodeURIComponent(name!)}/run`, {
        mode: runMode,
      });
    },
    onSuccess: (data: CronJobRun) => {
      setCompletedRun(null);
      setPollingRunId(data.id);
      toast({
        title: "Job Started",
        description: `The cron job has been manually triggered in ${runMode} mode.`,
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

  // Poll for job completion
  useEffect(() => {
    if (!pollingRunId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/cron-jobs/${encodeURIComponent(name!)}`);
        if (!response.ok) return;
        
        const jobData = await response.json();
        const latestRun = jobData.latestRun;

        if (latestRun && latestRun.id === pollingRunId) {
          if (latestRun.status === "success" || latestRun.status === "error") {
            setPollingRunId(null);
            setCompletedRun(latestRun);
            queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name] });
            queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name, "runs"] });
            
            toast({
              title: latestRun.status === "success" ? "Job Completed" : "Job Failed",
              description: latestRun.status === "success" 
                ? "The job has completed successfully. See results below."
                : "The job encountered an error. See details below.",
              variant: latestRun.status === "error" ? "destructive" : "default",
            });
          }
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, 1000); // Poll every second

    return () => clearInterval(pollInterval);
  }, [pollingRunId, name, toast]);

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

  const parseOutputData = (output: string | null): CronJobOutputData | null => {
    if (!output) return null;
    try {
      return JSON.parse(output);
    } catch {
      return null;
    }
  };

  const formatSummaryValue = (value: any): React.ReactNode => {
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return (
          <div className="space-y-1">
            {value.map((item, idx) => (
              <div key={idx} className="text-xs">• {formatSummaryValue(item)}</div>
            ))}
          </div>
        );
      }
      return (
        <div className="space-y-1">
          {Object.entries(value).map(([k, v]) => (
            <div key={k} className="text-xs">
              <span className="font-medium">{k}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </div>
          ))}
        </div>
      );
    }
    return String(value);
  };

  const isPolling = !!pollingRunId;

  return (
    <div className="space-y-6">
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
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-3 block">Execution Mode</Label>
                <RadioGroup
                  value={runMode}
                  onValueChange={(value) => setRunMode(value as "live" | "test")}
                  className="space-y-3"
                  disabled={isPolling}
                >
                  <div className="flex items-start space-x-3">
                    <RadioGroupItem value="live" id="mode-live" data-testid="radio-mode-live" disabled={isPolling} />
                    <div className="flex-1">
                      <Label htmlFor="mode-live" className="font-medium cursor-pointer">
                        Live Mode
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Execute the job and make database changes
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <RadioGroupItem value="test" id="mode-test" data-testid="radio-mode-test" disabled={isPolling} />
                    <div className="flex-1">
                      <Label htmlFor="mode-test" className="font-medium cursor-pointer">
                        Test Mode
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Dry run - no database changes will be made
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
              <Button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || isPolling}
                data-testid="button-run-now"
              >
                {isPolling ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Now ({runMode === "live" ? "Live" : "Test"})
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {completedRun && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {completedRun.status === "success" ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                  Execution Results
                </CardTitle>
                <CardDescription>
                  Latest manual execution completed at {format(new Date(completedRun.completedAt!), "MMM d, yyyy HH:mm:ss")}
                </CardDescription>
              </div>
              <Badge variant={completedRun.mode === "test" ? "outline" : "default"}>
                {completedRun.mode === "test" ? "Test Mode" : "Live Mode"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <div className="mt-1">
                  <Badge variant={completedRun.status === "success" ? "default" : "destructive"}>
                    {completedRun.status}
                  </Badge>
                </div>
              </div>
              {(() => {
                const outputData = parseOutputData(completedRun.output);
                return outputData && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Execution Time</p>
                    <p className="text-sm mt-1">{outputData.executionTimeSec} seconds</p>
                  </div>
                );
              })()}
            </div>

            {(() => {
              const outputData = parseOutputData(completedRun.output);
              return outputData?.summary && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-3">Summary</p>
                    <div className="grid grid-cols-2 gap-4">
                      {Object.entries(outputData.summary).map(([key, value]) => (
                        <div key={key}>
                          <p className="text-sm font-medium text-muted-foreground capitalize">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </p>
                          <div className="text-sm mt-1" data-testid={`result-summary-${key}`}>
                            {formatSummaryValue(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}

            {completedRun.error && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Error</p>
                  <pre className="text-sm bg-destructive/10 text-destructive p-4 rounded-md overflow-x-auto">
                    {completedRun.error}
                  </pre>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function CronJobSettings() {
  return (
    <CronJobLayout activeTab="settings">
      <CronJobSettingsContent />
    </CronJobLayout>
  );
}
