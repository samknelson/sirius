import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Play, Loader2, DollarSign } from "lucide-react";
import { format } from "date-fns";

interface ProcessStepProps {
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

export function ProcessStep({ wizardId, wizardType, data, onDataChange }: ProcessStepProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const processResults: ProcessResults | null = data?.processResults || null;
  const processProgress = data?.progress?.process;
  const isProcessing = processProgress?.status === 'processing';
  const isComplete = processResults !== null;
  const hasError = processProgress?.status === 'error';

  const validationResults = data?.validationResults;
  const accountId = data?.accountId;
  const selectedAccount = accounts.find((a: any) => a.id === accountId);

  useEffect(() => {
    if (isProcessing && !pollRef.current) {
      pollRef.current = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      }, 5000);
    }
    if (!isProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isProcessing, wizardId]);

  const startProcessing = async () => {
    setIsStarting(true);
    setError(null);
    try {
      await apiRequest("POST", `/api/wizards/${wizardId}/process`);
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start processing');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Process Dues Allocation</CardTitle>
          <CardDescription>
            Create ledger entries for dues deductions from the validated file
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isProcessing && !isComplete && !hasError && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <DollarSign className="h-12 w-12 text-muted-foreground" />
              <div className="text-center space-y-2">
                <p className="text-muted-foreground">
                  Ready to process {validationResults?.validRows?.toLocaleString() || 0} valid rows
                </p>
                {selectedAccount && (
                  <p className="text-sm text-muted-foreground">
                    Ledger Account: <strong>{selectedAccount.name}</strong>
                  </p>
                )}
                {validationResults && validationResults.invalidRows > 0 && (
                  <p className="text-sm text-amber-600">
                    Note: {validationResults.invalidRows.toLocaleString()} invalid rows will be skipped
                  </p>
                )}
              </div>
              <Button 
                onClick={startProcessing} 
                size="lg"
                className="gap-2"
                disabled={isStarting}
                data-testid="button-start-processing"
              >
                {isStarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isStarting ? 'Starting...' : 'Start Processing'}
              </Button>
            </div>
          )}

          {isProcessing && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center space-y-2">
                <p className="text-lg font-medium">Processing in background...</p>
                <p className="text-sm text-muted-foreground">
                  You can safely leave this page. You'll receive a notification when processing is complete.
                </p>
                {processProgress?.startedAt && (
                  <p className="text-xs text-muted-foreground">
                    Started {format(new Date(processProgress.startedAt), 'h:mm a')}
                  </p>
                )}
              </div>
            </div>
          )}

          {hasError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Processing Error</AlertTitle>
              <AlertDescription>
                {processProgress?.error || 'An error occurred during processing.'}
                <div className="mt-2">
                  <Button variant="outline" size="sm" onClick={startProcessing} disabled={isStarting} data-testid="button-retry-processing">
                    {isStarting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                    Retry
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isComplete && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {processResults.failureCount === 0 ? (
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                ) : (
                  <AlertCircle className="h-6 w-6 text-amber-600" />
                )}
                <span className="text-lg font-medium">
                  Processing Complete
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold">{processResults.totalRows.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Total Rows</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-green-600">{processResults.createdCount.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Entries Created</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-blue-600">{processResults.successCount.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Successful</div>
                  </CardContent>
                </Card>
                {(data?.skippedDuplicateCount || 0) > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-amber-600">{(data?.skippedDuplicateCount || 0).toLocaleString()}</div>
                      <div className="text-sm text-muted-foreground">Skipped (Duplicates)</div>
                    </CardContent>
                  </Card>
                )}
                {processResults.failureCount > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-red-600">{processResults.failureCount.toLocaleString()}</div>
                      <div className="text-sm text-muted-foreground">Errors</div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {processResults.errors && processResults.errors.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Processing Errors</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {processResults.errors.map((error, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-sm">
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
