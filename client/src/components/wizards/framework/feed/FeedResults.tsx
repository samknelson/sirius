import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2,
  XCircle,
  Download,
  RefreshCw,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface ResultsData {
  processResults: any | null;
  validationResults: any | null;
  progress?: { status?: string; percentComplete?: number; error?: string } | null;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "success" | "danger" | "muted";
}) {
  const color =
    tone === "success"
      ? "text-green-600"
      : tone === "danger"
        ? "text-red-600"
        : "";
  return (
    <Card>
      <CardContent className="pt-6 text-center">
        <p className={`text-2xl font-bold ${color}`}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Generic escape-hatch results/review step for feed/import wizards. Reads
 * `processResults` through the fixed dispatcher `getData` route and renders
 * the shared counts plus whatever wizard-specific summaries the result
 * object happens to carry (employer match, card checks, benefits, charges,
 * inactivity scan, dues comparison). The "Reprocess unmatched" / "Rescan"
 * actions post to the fixed `run` route on this same step — the plugin
 * attaches the matching `run` handler, so no wizard-specific route exists.
 */
export function FeedResults({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();
  const [actionRunning, setActionRunning] = useState(false);

  const { data, isLoading } = useQuery<ResultsData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
    refetchInterval: actionRunning ? 1500 : false,
  });

  // The bespoke run action (reprocess / rescan) returns 202 immediately and
  // works in the background; poll the step's own progress to completion.
  useEffect(() => {
    if (!actionRunning) return;
    const status = data?.progress?.status;
    if (status === "completed" || status === "failed") {
      setActionRunning(false);
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      if (status === "failed") {
        toast({
          title: "Action Failed",
          description: data?.progress?.error || "The action did not complete.",
          variant: "destructive",
        });
      }
    }
  }, [actionRunning, data?.progress?.status, data?.progress?.error, wizardId, toast]);

  const running = actionRunning || step.progress?.status === "in_progress";

  const actionMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/run`, {}),
    onSuccess: () => {
      setActionRunning(true);
    },
    onError: (err: Error) => {
      toast({
        title: "Action Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  const r = data?.processResults;
  if (!r) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{step.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No results yet</AlertTitle>
            <AlertDescription>
              Run the process step first to generate results.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const errors: any[] = Array.isArray(r.errors) ? r.errors : [];
  const comparison = r.cardCheckComparisonReport;
  const hasUnmatched =
    Array.isArray(r.withoutEmployerMatch) && r.withoutEmployerMatch.length > 0;
  const canRescan = !!comparison;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{step.name}</CardTitle>
              <CardDescription>Import results summary</CardDescription>
            </div>
            {r.resultsFileId && (
              <Button variant="outline" asChild data-testid="button-download-results">
                <a href={`/api/files/${r.resultsFileId}/download`} download>
                  <Download className="h-4 w-4 mr-2" />
                  Download results CSV
                </a>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Total Rows" value={r.totalRows ?? 0} />
            <Stat label="Created" value={r.createdCount ?? 0} tone="success" />
            <Stat label="Updated" value={r.updatedCount ?? 0} tone="success" />
            <Stat
              label="Failed"
              value={r.failureCount ?? 0}
              tone={r.failureCount ? "danger" : "muted"}
            />
          </div>

          {/* BTU worker import: employer match breakdown + reprocess */}
          {(r.withEmployerMatch !== undefined ||
            r.withoutEmployerMatch !== undefined ||
            r.terminatedByAbsence !== undefined) && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {r.withEmployerMatch !== undefined && (
                  <Stat
                    label="With Employer Match"
                    value={
                      Array.isArray(r.withEmployerMatch)
                        ? r.withEmployerMatch.length
                        : r.withEmployerMatch
                    }
                  />
                )}
                {r.withoutEmployerMatch !== undefined && (
                  <Stat
                    label="Without Employer Match"
                    value={
                      Array.isArray(r.withoutEmployerMatch)
                        ? r.withoutEmployerMatch.length
                        : r.withoutEmployerMatch
                    }
                  />
                )}
                {r.terminatedByAbsence !== undefined && (
                  <Stat
                    label="Terminated By Absence"
                    value={
                      Array.isArray(r.terminatedByAbsence)
                        ? r.terminatedByAbsence.length
                        : r.terminatedByAbsence
                    }
                  />
                )}
              </div>
              {hasUnmatched && (
                <Button
                  variant="outline"
                  onClick={() => actionMutation.mutate()}
                  disabled={running || actionMutation.isPending}
                  data-testid="button-reprocess-unmatched"
                >
                  {running || actionMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Reprocess unmatched
                </Button>
              )}
            </div>
          )}

          {/* Card check import */}
          {(r.cardchecksCreated !== undefined ||
            r.skippedDuplicate !== undefined ||
            (Array.isArray(r.notFoundBpsIds) &&
              r.notFoundBpsIds.length > 0)) && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {r.cardchecksCreated !== undefined && (
                  <Stat
                    label="Card Checks Created"
                    value={r.cardchecksCreated}
                    tone="success"
                  />
                )}
                {r.skippedDuplicate !== undefined && (
                  <Stat label="Skipped (duplicate)" value={r.skippedDuplicate} />
                )}
                {Array.isArray(r.notFoundBpsIds) && (
                  <Stat label="Not Found" value={r.notFoundBpsIds.length} />
                )}
              </div>
              {Array.isArray(r.notFoundBpsIds) &&
                r.notFoundBpsIds.length > 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Workers not found</AlertTitle>
                    <AlertDescription className="font-mono text-xs break-words">
                      {r.notFoundBpsIds.join(", ")}
                    </AlertDescription>
                  </Alert>
                )}
            </div>
          )}

          {/* Dues allocation */}
          {(r.allocatedWorkers !== undefined ||
            r.skippedDuplicateCount !== undefined) && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {r.allocatedWorkers !== undefined && (
                <Stat
                  label="Allocated Workers"
                  value={
                    Array.isArray(r.allocatedWorkers)
                      ? r.allocatedWorkers.length
                      : r.allocatedWorkers
                  }
                  tone="success"
                />
              )}
              {r.skippedDuplicateCount !== undefined && (
                <Stat
                  label="Skipped (duplicate)"
                  value={r.skippedDuplicateCount}
                />
              )}
            </div>
          )}

          {/* Benefits + charges (GBHET) */}
          {Array.isArray(r.benefitsSummary) && r.benefitsSummary.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Benefits Created</h3>
              <div className="flex flex-wrap gap-2">
                {r.benefitsSummary.map((b: any) => (
                  <Badge key={b.benefitId} variant="secondary">
                    {b.benefitName}: {b.count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {r.chargesSummary && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Charges Generated</AlertTitle>
              <AlertDescription>
                {r.chargesSummary.count} charge(s), total{" "}
                {r.chargesSummary.totalAmount}
              </AlertDescription>
            </Alert>
          )}

          {/* Inactivity scan (HTA) */}
          {r.inactivityScan?.ran && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Scanned" value={r.inactivityScan.scanned} />
              <Stat
                label="Deactivated"
                value={r.inactivityScan.deactivated}
                tone="danger"
              />
              <Stat
                label="Already Inactive"
                value={r.inactivityScan.alreadyInactive}
              />
              <Stat label="Still Active" value={r.inactivityScan.stillActive} />
            </div>
          )}

          {errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  Errors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1">
                    {errors.map((e, i) => (
                      <div
                        key={i}
                        className="text-sm text-muted-foreground border-l-2 border-red-200 pl-3 py-1"
                      >
                        <span className="font-mono">Row {e.rowIndex + 1}</span>
                        <span className="ml-2">{e.message}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Dues card-check comparison report + rescan */}
      {comparison && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  Card Check Comparison
                </CardTitle>
                <CardDescription>
                  Dues allocation vs. signed card checks
                </CardDescription>
              </div>
              {canRescan && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actionMutation.mutate()}
                  disabled={running || actionMutation.isPending}
                  data-testid="button-rescan-comparison"
                >
                  {running || actionMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Rescan
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {Array.isArray(comparison.rows) && comparison.rows.length > 0 ? (
              <ScrollArea className="h-[360px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(comparison.rows[0]).map((k) => (
                        <TableHead key={k}>{k}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.rows.map((row: any, i: number) => (
                      <TableRow key={i}>
                        {Object.keys(comparison.rows[0]).map((k) => (
                          <TableCell key={k} className="whitespace-nowrap">
                            {row[k] != null ? String(row[k]) : ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">
                No comparison rows to display.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
