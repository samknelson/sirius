import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { Eye, CheckCircle2, XCircle } from "lucide-react";
import { CronJobLayout } from "@/components/layouts/CronJobLayout";

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
  userFirstName?: string | null;
  userLastName?: string | null;
  userEmail?: string | null;
}

interface CronJobOutputData {
  executionTimeMs: number;
  executionTimeSec: string;
  summary: {
    [key: string]: any;
  };
}

function StatusBadge({ status }: { status: string }) {
  const variant = 
    status === 'success' ? 'default' : 
    status === 'error' ? 'destructive' : 
    status === 'running' ? 'secondary' : 
    'outline';
  
  return <Badge variant={variant} data-testid={`badge-status-${status}`}>{status}</Badge>;
}

function formatTriggeredBy(run: CronJobRun): string {
  if (!run.triggeredBy || run.triggeredBy === 'scheduler') {
    return 'Scheduler';
  }
  
  if (run.userEmail) {
    const fullName = [run.userFirstName, run.userLastName].filter(Boolean).join(' ');
    return fullName ? `${fullName} (${run.userEmail})` : run.userEmail;
  }
  
  return run.triggeredBy;
}

function parseOutputData(output: string | null): CronJobOutputData | null {
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function CronJobHistoryContent() {
  const { name } = useParams<{ name: string }>();
  const [selectedRun, setSelectedRun] = useState<CronJobRun | null>(null);

  const { data: runs = [], isLoading } = useQuery<CronJobRun[]>({
    queryKey: ["/api/cron-jobs", name, "runs"],
    queryFn: async () => {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(name!)}/runs`);
      if (!response.ok) throw new Error('Failed to fetch run history');
      return response.json();
    },
    enabled: !!name,
  });

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run History</CardTitle>
        <CardDescription>Complete execution history for this job</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-history">
            No runs yet. This job hasn't been executed.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Triggered By</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const outputData = parseOutputData(run.output);
                return (
                  <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                    <TableCell className="text-sm">
                      {format(new Date(run.startedAt), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {outputData ? `${outputData.executionTimeSec}s` : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      {run.mode === 'test' ? (
                        <Badge variant="outline">Test</Badge>
                      ) : (
                        <Badge variant="default">Live</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatTriggeredBy(run)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {run.error ? (
                        <span className="text-destructive truncate block max-w-xs">Error: {run.error}</span>
                      ) : outputData?.summary ? (
                        <div className="space-x-2">
                          {outputData.summary.totalDeleted !== undefined && (
                            <span className="font-mono">{outputData.summary.totalDeleted} deleted</span>
                          )}
                          {outputData.summary.totalWizardsChecked !== undefined && (
                            <span className="text-muted-foreground">({outputData.summary.totalWizardsChecked} checked)</span>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedRun(run)}
                        data-testid={`button-view-${run.id}`}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* View Run Details Dialog */}
      <Dialog open={selectedRun !== null} onOpenChange={(open) => !open && setSelectedRun(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-run-detail">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  {selectedRun?.status === "success" ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : selectedRun?.status === "error" ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : null}
                  Cron Job Run Details
                </DialogTitle>
                <DialogDescription>
                  {selectedRun && format(new Date(selectedRun.startedAt), "MMMM d, yyyy 'at' HH:mm:ss")}
                </DialogDescription>
              </div>
              <Badge variant={selectedRun?.mode === "test" ? "outline" : "default"}>
                {selectedRun?.mode === "test" ? "Test Mode" : "Live Mode"}
              </Badge>
            </div>
          </DialogHeader>
          {selectedRun && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <div className="mt-1">
                    <StatusBadge status={selectedRun.status} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Triggered By</p>
                  <p className="text-sm mt-1">{formatTriggeredBy(selectedRun)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Started At</p>
                  <p className="text-sm mt-1">
                    {format(new Date(selectedRun.startedAt), "MMM d, yyyy HH:mm:ss")}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Completed At</p>
                  <p className="text-sm mt-1">
                    {selectedRun.completedAt 
                      ? format(new Date(selectedRun.completedAt), "MMM d, yyyy HH:mm:ss")
                      : "In Progress"}
                  </p>
                </div>
                {(() => {
                  const outputData = parseOutputData(selectedRun.output);
                  return outputData && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Execution Time</p>
                      <p className="text-sm mt-1">{outputData.executionTimeSec} seconds</p>
                    </div>
                  );
                })()}
              </div>

              {(() => {
                const outputData = parseOutputData(selectedRun.output);
                return outputData?.summary && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-3">Execution Summary</p>
                      <div className="grid grid-cols-2 gap-4">
                        {Object.entries(outputData.summary).map(([key, value]) => (
                          <div key={key}>
                            <p className="text-sm font-medium text-muted-foreground capitalize">
                              {key.replace(/([A-Z])/g, ' $1').trim()}
                            </p>
                            <div className="text-sm mt-1" data-testid={`detail-summary-${key}`}>
                              {formatSummaryValue(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}

              {selectedRun.error && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Error Details</p>
                    <pre className="text-sm bg-destructive/10 text-destructive p-4 rounded-md overflow-x-auto whitespace-pre-wrap">
                      {selectedRun.error}
                    </pre>
                  </div>
                </>
              )}

              {!parseOutputData(selectedRun.output) && selectedRun.output && !selectedRun.error && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Raw Output</p>
                    <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto whitespace-pre-wrap">
                      {selectedRun.output}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function CronJobHistory() {
  return (
    <CronJobLayout activeTab="history">
      <CronJobHistoryContent />
    </CronJobLayout>
  );
}
