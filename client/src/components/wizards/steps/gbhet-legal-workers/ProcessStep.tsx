import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Play, Loader2, Database } from "lucide-react";
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

  const processResults: ProcessResults | null = data?.processResults || null;
  const processProgress = data?.progress?.process;
  const isProcessing = processProgress?.status === 'processing';
  const isComplete = processResults !== null;
  const hasError = processProgress?.status === 'error';

  const validationResults = data?.validationResults;
  const mode = data?.mode || 'create';

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
          <CardTitle>Process Data</CardTitle>
          <CardDescription>
            {mode === 'create' 
              ? 'Create new worker records from validated data' 
              : 'Update existing worker records with validated data'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isProcessing && !isComplete && !hasError && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Database className="h-12 w-12 text-muted-foreground" />
              <div className="text-center space-y-2">
                <p className="text-muted-foreground">
                  Ready to process {validationResults?.validRows?.toLocaleString() || 0} valid rows
                </p>
                {validationResults && validationResults.invalidRows > 0 && (
                  <p className="text-sm text-amber-600">
                    Note: {validationResults.invalidRows.toLocaleString()} invalid rows will be skipped
                  </p>
                )}
              </div>
              <Button 
                onClick={startProcessing} 
                size="lg"
                disabled={isStarting}
                data-testid="button-start-processing"
              >
                {isStarting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
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
              <XCircle className="h-4 w-4" />
              <AlertTitle>Processing Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isComplete && !isProcessing && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Processing Results</h3>
                <div className="flex items-center gap-2">
                  <Button 
                    onClick={startProcessing} 
                    variant="outline"
                    size="sm"
                    disabled={isStarting}
                    data-testid="button-reprocess"
                  >
                    {isStarting ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-3 w-3" />
                    )}
                    Re-process
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-2xl font-bold" data-testid="text-total-rows">
                        {processResults.totalRows.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Rows</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <p className="text-2xl font-bold text-green-600" data-testid="text-created-count">
                          {(processResults.createdCount ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">Created</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <CheckCircle2 className="h-5 w-5 text-blue-600" />
                        <p className="text-2xl font-bold text-blue-600" data-testid="text-updated-count">
                          {(processResults.updatedCount ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">Updated</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <XCircle className="h-5 w-5 text-red-600" />
                        <p className="text-2xl font-bold text-red-600" data-testid="text-failure-count">
                          {processResults.failureCount.toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">Failed</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {processResults.failureCount > 0 && processResults.errors.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Processing Errors</CardTitle>
                    <CardDescription>
                      Rows that failed to process. Review and fix these issues.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-3">
                        {processResults.errors.map((error, idx) => (
                          <div 
                            key={idx} 
                            className="border-l-2 border-red-200 pl-4 py-2 space-y-1"
                            data-testid={`error-item-${idx}`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="space-y-1 flex-1">
                                <p className="text-sm font-medium">
                                  <span className="font-mono">Row {error.rowIndex + 1}</span>
                                </p>
                                <p className="text-sm text-red-600">{error.message}</p>
                                {error.data && (
                                  <details className="text-xs text-muted-foreground">
                                    <summary className="cursor-pointer hover:text-foreground">
                                      View row data
                                    </summary>
                                    <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                                      {JSON.stringify(error.data, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {processResults.failureCount === 0 && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Processing Complete</AlertTitle>
                  <AlertDescription>
                    Successfully {mode === 'create' ? 'created' : 'updated'} {processResults.successCount.toLocaleString()} worker{processResults.successCount !== 1 ? 's' : ''}.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
