import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  hoursWritten: number;
  shiftsWritten: number;
  duesEventsEmitted: number;
  duesTotal: string;
  memberStatusesRecorded: number;
  warnings: string[];
  errors: Array<{ rowIndex: number; message: string }>;
  rateWarningsCount: number;
  completedAt?: string;
}

interface ResultsData {
  processResults: ProcessResults | null;
}

/** Review step: summary of everything the upload wrote (or skipped). */
export function Local26Results({ wizardId, step }: WizardStepComponentProps) {
  const { data, isLoading } = useQuery<ResultsData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
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
        <CardContent className="py-12 text-center text-muted-foreground">
          No results yet — run the Process step first.
        </CardContent>
      </Card>
    );
  }

  const stat = (label: string, value: string | number, testId: string) => (
    <Card>
      <CardContent className="pt-6 text-center">
        <p className="text-2xl font-bold" data-testid={testId}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload Results</CardTitle>
          <CardDescription>
            Summary of workers, hours, shifts and dues written by this upload
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {r.failureCount === 0 ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Processing complete</AlertTitle>
              <AlertDescription>
                All {r.totalRows.toLocaleString()} rows processed successfully.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Processing finished with errors</AlertTitle>
              <AlertDescription>
                {r.failureCount.toLocaleString()} of {r.totalRows.toLocaleString()} rows
                failed — see details below. Re-running the Process step retries
                every row; successful writes are idempotent.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stat("Workers Created", r.createdCount, "text-created-count")}
            {stat("Workers Updated", r.updatedCount, "text-updated-count")}
            {stat("Weekly Hours Written", r.hoursWritten, "text-hours-written")}
            {stat("Shift Counts Written", r.shiftsWritten, "text-shifts-written")}
            {stat("Dues Weeks Written", r.duesEventsEmitted, "text-dues-events")}
            {stat("Dues Total", `$${r.duesTotal}`, "text-dues-total")}
            {stat("Member Statuses", r.memberStatusesRecorded, "text-member-statuses")}
            {stat("Rate Warnings", r.rateWarningsCount, "text-rate-warnings")}
          </div>

          {r.warnings.length > 0 && (
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  Warnings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {r.warnings.map((w, idx) => (
                  <div
                    key={idx}
                    className="text-sm text-muted-foreground border-l-2 border-amber-300 pl-3 py-1"
                    data-testid={`process-warning-${idx}`}
                  >
                    {w}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {r.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Row Errors</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1">
                    {r.errors.map((e, idx) => (
                      <div
                        key={idx}
                        className="text-sm text-muted-foreground border-l-2 border-red-200 pl-3 py-1"
                        data-testid={`process-error-${idx}`}
                      >
                        <Badge variant="outline" className="font-mono mr-2">
                          Row {e.rowIndex + 1}
                        </Badge>
                        {e.message}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
