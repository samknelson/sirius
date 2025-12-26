import { useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Play, Loader2, CheckCircle2, XCircle, Save, Info } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CronJobLayout, useCronJobLayout } from "@/components/layouts/CronJobLayout";
import { format } from "date-fns";
import { CronJobRun } from "@/lib/cron-types";

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
  const [runMode, setRunMode] = useState<"live" | "test">("test");
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);
  const [completedRun, setCompletedRun] = useState<CronJobRun | null>(null);
  const [schedule, setSchedule] = useState(job.schedule);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  
  // Job-specific settings state
  const mergedSettings = { ...job.defaultSettings, ...(job.settings || {}) };
  const [localSettings, setLocalSettings] = useState<Record<string, unknown>>(mergedSettings);

  // Update local schedule when job changes
  useEffect(() => {
    setSchedule(job.schedule);
  }, [job.schedule]);

  // Update local settings when job changes
  useEffect(() => {
    const merged = { ...job.defaultSettings, ...(job.settings || {}) };
    setLocalSettings(merged);
  }, [job.settings, job.defaultSettings]);

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

  const updateScheduleMutation = useMutation({
    mutationFn: async (newSchedule: string) => {
      return await apiRequest("PATCH", `/api/cron-jobs/${encodeURIComponent(name!)}`, { 
        schedule: newSchedule 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name] });
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs"] });
      setScheduleError(null);
      toast({
        title: "Schedule Updated",
        description: "The cron job schedule has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      const errorMessage = error.message || "Failed to update schedule";
      setScheduleError(errorMessage);
      toast({
        title: "Failed to Update Schedule",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: Record<string, unknown>) => {
      return await apiRequest("PATCH", `/api/cron-jobs/${encodeURIComponent(name!)}`, { settings });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name] });
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs"] });
      toast({
        title: "Settings Updated",
        description: "The job settings have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Settings",
        description: error.message || "Failed to update job settings",
        variant: "destructive",
      });
    },
  });

  const handleSettingChange = (key: string, value: unknown) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate(localSettings);
  };

  const hasSettingsChanges = JSON.stringify(localSettings) !== JSON.stringify(mergedSettings);

  const validateCronExpression = (expr: string): boolean => {
    // Basic validation - cron expressions have 5 or 6 parts separated by spaces
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
      setScheduleError("Cron expression must have 5 or 6 parts");
      return false;
    }
    
    // Each part should be valid (number, *, /, -, or ,)
    const cronPartRegex = /^(\*|(\d+|\d+-\d+)(,(\d+|\d+-\d+))*)(\/\d+)?$/;
    for (let i = 0; i < parts.length; i++) {
      if (!cronPartRegex.test(parts[i])) {
        setScheduleError(`Invalid cron expression part: ${parts[i]}`);
        return false;
      }
    }
    
    setScheduleError(null);
    return true;
  };

  const handleScheduleUpdate = () => {
    if (!validateCronExpression(schedule)) {
      return;
    }
    updateScheduleMutation.mutate(schedule);
  };

  const hasScheduleChanges = schedule !== job.schedule;

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
          <div className="flex items-center justify-between" data-testid="enable-job-container">
            <div>
              <p className="font-medium">Enable Job</p>
              <p className="text-sm text-muted-foreground">
                Allow this job to run on its schedule
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{job.isEnabled ? 'Enabled' : 'Disabled'}</span>
              <Switch
                checked={job.isEnabled}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                disabled={toggleMutation.isPending}
                data-testid="switch-enabled"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div>
              <Label htmlFor="schedule" className="font-medium">Schedule</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Cron expression defining when this job should run
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  id="schedule"
                  value={schedule}
                  onChange={(e) => {
                    setSchedule(e.target.value);
                    setScheduleError(null);
                  }}
                  placeholder="0 2 * * *"
                  className="font-mono"
                  data-testid="input-schedule"
                />
                <Button
                  onClick={handleScheduleUpdate}
                  disabled={!hasScheduleChanges || updateScheduleMutation.isPending}
                  data-testid="button-save-schedule"
                >
                  {updateScheduleMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>
              </div>
              {scheduleError && (
                <Alert variant="destructive">
                  <AlertDescription>{scheduleError}</AlertDescription>
                </Alert>
              )}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <p className="font-medium">Cron Expression Format:</p>
                    <p className="text-xs font-mono">* * * * * (or * * * * * *)</p>
                    <p className="text-xs">
                      Minute (0-59), Hour (0-23), Day of Month (1-31), Month (1-12), Day of Week (0-7)
                    </p>
                    <div className="text-xs mt-2 space-y-1">
                      <p><code className="bg-muted px-1 rounded">0 2 * * *</code> - Daily at 2:00 AM</p>
                      <p><code className="bg-muted px-1 rounded">*/15 * * * *</code> - Every 15 minutes</p>
                      <p><code className="bg-muted px-1 rounded">0 0 * * 0</code> - Weekly on Sunday at midnight</p>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            </div>
          </div>

          {job.settingsFields && job.settingsFields.length > 0 && (
            <>
              <Separator />
              <div className="space-y-4">
                <div>
                  <Label className="font-medium">Job-Specific Settings</Label>
                  <p className="text-sm text-muted-foreground mb-2">
                    Configure parameters for this job
                  </p>
                </div>
                <div className="space-y-4">
                  {job.settingsFields.map((field) => (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={`setting-${field.key}`}>{field.label}</Label>
                      {field.description && (
                        <p className="text-sm text-muted-foreground">{field.description}</p>
                      )}
                      {field.type === "number" && (
                        <Input
                          id={`setting-${field.key}`}
                          type="number"
                          min={field.min}
                          max={field.max}
                          value={String(localSettings[field.key] ?? "")}
                          onChange={(e) => {
                            let val = parseInt(e.target.value) || 0;
                            if (field.min !== undefined) val = Math.max(field.min, val);
                            if (field.max !== undefined) val = Math.min(field.max, val);
                            handleSettingChange(field.key, val);
                          }}
                          data-testid={`input-setting-${field.key}`}
                        />
                      )}
                      {field.type === "string" && (
                        <Input
                          id={`setting-${field.key}`}
                          type="text"
                          value={String(localSettings[field.key] ?? "")}
                          onChange={(e) => handleSettingChange(field.key, e.target.value)}
                          data-testid={`input-setting-${field.key}`}
                        />
                      )}
                      {field.type === "boolean" && (
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`setting-${field.key}`}
                            checked={Boolean(localSettings[field.key])}
                            onCheckedChange={(checked) => handleSettingChange(field.key, checked)}
                            data-testid={`switch-setting-${field.key}`}
                          />
                          <span className="text-sm text-muted-foreground">
                            {localSettings[field.key] ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                  <Button
                    onClick={handleSaveSettings}
                    disabled={!hasSettingsChanges || updateSettingsMutation.isPending}
                    data-testid="button-save-settings"
                  >
                    {updateSettingsMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}

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
              if (!outputData?.summary) return null;

              const { reportTypes, totalRunsDeleted, ...otherSummary } = outputData.summary;

              // Check if this is the delete-expired-reports job with the new format
              const hasReportTypes = Array.isArray(reportTypes);

              return (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-3">Summary</p>
                    
                    {hasReportTypes ? (
                      <div className="space-y-4">
                        {reportTypes.map((type: any) => (
                          <div key={type.reportType} className="border rounded-lg p-4">
                            <p className="font-medium mb-2">{type.reportTypeName}</p>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground">Total Reports</p>
                                <p className="mt-1">{type.totalReports}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Old Runs Deleted</p>
                                <p className="mt-1">{type.runsDeleted}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                        
                        <div className="border-t pt-4">
                          <div className="flex justify-between items-center">
                            <p className="font-medium">Grand Total</p>
                            <p className="text-lg font-semibold">{totalRunsDeleted} old runs deleted</p>
                          </div>
                        </div>
                        
                        {Object.keys(otherSummary).length > 0 && (
                          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                            {Object.entries(otherSummary).map(([key, value]) => (
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
                        )}
                      </div>
                    ) : (
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
                    )}
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
