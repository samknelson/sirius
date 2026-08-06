import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  Play,
  Loader2,
  Eye,
  Info,
} from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface PreviewWorkerRow {
  rowIndex: number;
  ssnMasked: string;
  name: string | null;
  workerId: string | null;
  statusName: string;
  reportedHours: number;
  activeHours: number;
  fmlaHours: number;
  totalHours: number;
  fmlaSplit: boolean;
  threshold: number | null;
  billedAmount: string;
  withholdingAmount: string | null;
  notes: string[];
}

interface PreviewResults {
  year: number;
  month: number;
  withholdingMapped: boolean;
  workers: PreviewWorkerRow[];
  totals: {
    workers: number;
    reportedHours: number;
    activeHours: number;
    fmlaHours: number;
    totalHours: number;
    billedAmount: string;
    withholdingTotal: string | null;
  };
  completedAt: string;
}

interface PreviewData {
  previewResults: PreviewResults | null;
}

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * `preview` step for the BAO monthly hours wizard: a read-only, per-worker
 * projection of what processing WILL do — hour totals with the Active/FMLA
 * breakout, the billed amount from the effective employer rates and
 * billed-status rules, and the expected employee withholding (hidden when
 * that column is not mapped). Nothing is written until the user proceeds to
 * the Process step.
 */
export function BaoPreview({ wizardId, step }: WizardStepComponentProps) {
  const { data: stepData, isLoading } = useQuery<PreviewData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = stepData?.previewResults ?? null;

  const pollForCompletion = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, attempt === 0 ? 1200 : 4000),
      );
      const res = await fetch(`/api/wizards/${wizardId}`, {
        credentials: "include",
      });
      if (!res.ok) continue;
      const wizard = await res.json();
      const progress = wizard?.data?.progress?.[step.id]?.status;
      if (progress === "completed" || progress === "failed") {
        setIsRunning(false);
        queryClient.invalidateQueries({
          queryKey: [`/api/wizards/${wizardId}`],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
        });
        if (progress === "failed") {
          setError(
            wizard?.data?.progress?.[step.id]?.error || "Preview failed",
          );
        }
        return;
      }
    }
    setError(
      "The preview is taking longer than expected. Please refresh the page to check the results.",
    );
    setIsRunning(false);
  };

  const startPreview = async () => {
    setIsRunning(true);
    setError(null);
    try {
      await apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/run`,
        {},
      );
      await pollForCompletion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setIsRunning(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  const withholdingShown = preview?.withholdingMapped ?? false;
  const splitCount = preview?.workers.filter((w) => w.fmlaSplit).length ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            Review per-worker hours, the FMLA breakout, and billing impact
            before anything is written. Nothing is saved until you run the
            Process step.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive" data-testid="alert-preview-error">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isRunning && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Computing preview…</p>
            </div>
          )}

          {!isRunning && !preview && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Eye className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground text-center">
                Ready to compute a read-only preview of hours, billing, and
                withholding for this upload.
              </p>
              <Button
                onClick={startPreview}
                size="lg"
                data-testid="button-start-preview"
              >
                <Play className="mr-2 h-4 w-4" />
                Compute Preview
              </Button>
            </div>
          )}

          {!isRunning && preview && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" data-testid="badge-preview-workers">
                    {preview.totals.workers} worker
                    {preview.totals.workers === 1 ? "" : "s"}
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-preview-hours">
                    {fmtHours(preview.totals.totalHours)} total hours
                  </Badge>
                  {splitCount > 0 && (
                    <Badge variant="outline" data-testid="badge-preview-splits">
                      {splitCount} FMLA split{splitCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                  <Badge data-testid="badge-preview-billed">
                    ${preview.totals.billedAmount} billed
                  </Badge>
                  {withholdingShown && preview.totals.withholdingTotal && (
                    <Badge
                      variant="outline"
                      data-testid="badge-preview-withholding"
                    >
                      ${preview.totals.withholdingTotal} withholding
                    </Badge>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startPreview}
                  data-testid="button-recompute-preview"
                >
                  <Play className="mr-2 h-4 w-4" />
                  Recompute
                </Button>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Worker</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Reported</TableHead>
                      <TableHead className="text-right">Active</TableHead>
                      <TableHead className="text-right">FMLA</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      {withholdingShown && (
                        <TableHead className="text-right">
                          Withholding
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.workers.map((w) => (
                      <TableRow
                        key={w.rowIndex}
                        data-testid={`row-preview-${w.rowIndex}`}
                      >
                        <TableCell>
                          <div className="font-medium">
                            {w.name || "(no name)"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {w.ssnMasked}
                          </div>
                          {w.notes.length > 0 && (
                            <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 space-y-0.5">
                              {w.notes.map((n, idx) => (
                                <div key={idx} className="flex items-start gap-1">
                                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                                  <span>{n}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {w.fmlaSplit ? (
                            <div className="space-y-1">
                              <Badge variant="outline">Active + FMLA</Badge>
                              {w.threshold !== null && (
                                <div className="text-xs text-muted-foreground">
                                  threshold {fmtHours(w.threshold)}
                                </div>
                              )}
                            </div>
                          ) : (
                            w.statusName
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtHours(w.reportedHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtHours(w.activeHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {w.fmlaHours > 0 ? fmtHours(w.fmlaHours) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {fmtHours(w.totalHours)}
                        </TableCell>
                        <TableCell className="text-right">
                          ${w.billedAmount}
                        </TableCell>
                        {withholdingShown && (
                          <TableCell className="text-right">
                            {w.withholdingAmount
                              ? `$${w.withholdingAmount}`
                              : "—"}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>Totals</TableCell>
                      <TableCell />
                      <TableCell className="text-right">
                        {fmtHours(preview.totals.reportedHours)}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtHours(preview.totals.activeHours)}
                      </TableCell>
                      <TableCell className="text-right">
                        {preview.totals.fmlaHours > 0
                          ? fmtHours(preview.totals.fmlaHours)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtHours(preview.totals.totalHours)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${preview.totals.billedAmount}
                      </TableCell>
                      {withholdingShown && (
                        <TableCell className="text-right">
                          {preview.totals.withholdingTotal
                            ? `$${preview.totals.withholdingTotal}`
                            : "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <p className="text-sm text-muted-foreground">
                This preview is read-only. Use the wizard navigation to go back
                and adjust the upload, or continue to the Process step to apply
                these changes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
