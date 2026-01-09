import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Download, DollarSign } from "lucide-react";
import { format } from "date-fns";

interface ResultsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessError {
  rowIndex: number;
  message: string;
  data?: Record<string, any>;
}

interface ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  errors: ProcessError[];
  resultsFileId?: string;
  completedAt?: string;
}

export function ResultsStep({ wizardId, wizardType, data, onDataChange }: ResultsStepProps) {
  const results: ProcessResults | null = data?.processResults || null;

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const accountId = data?.accountId;
  const selectedAccount = accounts.find((a: any) => a.id === accountId);

  if (!results) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            No results available. Please complete the processing step first.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isSuccess = results.failureCount === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isSuccess ? (
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            ) : (
              <AlertCircle className="h-6 w-6 text-amber-600" />
            )}
            Import Results
          </CardTitle>
          <CardDescription>
            {isSuccess
              ? "All dues allocations were processed successfully"
              : `Completed with ${results.failureCount} error(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold">{results.totalRows.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Rows</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-green-600">{results.createdCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Entries Created</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-blue-600">{results.successCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Successful</div>
              </CardContent>
            </Card>
            {results.failureCount > 0 && (
              <Card>
                <CardContent className="pt-6 text-center">
                  <div className="text-3xl font-bold text-red-600">{results.failureCount.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground">Errors</div>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Import Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {selectedAccount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ledger Account:</span>
                  <span className="font-medium">{selectedAccount.name}</span>
                </div>
              )}
              {results.completedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Completed:</span>
                  <span className="font-medium">{format(new Date(results.completedAt), 'PPpp')}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {results.errors && results.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Processing Errors</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <div className="space-y-2">
                    {results.errors.map((error, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm p-2 rounded bg-red-50 dark:bg-red-950/20">
                        <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                        <div>
                          <span className="font-medium">Row {error.rowIndex + 1}:</span>{' '}
                          <span className="text-muted-foreground">{error.message}</span>
                        </div>
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
