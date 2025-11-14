import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Play, Loader2, Database } from "lucide-react";

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
  successCount: number;
  failureCount: number;
  errors: ProcessError[];
  completedAt?: string;
}

export function ProcessStep({ wizardId, wizardType, data, onDataChange }: ProcessStepProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0, successCount: 0, failureCount: 0 });
  const [results, setResults] = useState<ProcessResults | null>(data?.processResults || null);
  const [error, setError] = useState<string | null>(null);
  const [wizardStatus, setWizardStatus] = useState<string | null>(null);

  const { data: wizard } = useQuery<any>({
    queryKey: ["/api/wizards", wizardId],
  });

  const validationResults = data?.validationResults;
  const mode = data?.mode || 'create';

  const startProcessing = async () => {
    setIsProcessing(true);
    setError(null);
    setProgress({ processed: 0, total: 0, successCount: 0, failureCount: 0 });

    try {
      const eventSource = new EventSource(`/api/wizards/${wizardId}/process`, {
        withCredentials: true,
      });

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'progress') {
          setProgress({
            processed: data.processed,
            total: data.total,
            successCount: data.successCount,
            failureCount: data.failureCount,
          });
        } else if (data.type === 'complete') {
          setResults(data.results);
          setWizardStatus(data.wizardStatus);
          setIsProcessing(false);
          eventSource.close();
          // Invalidate wizard query to refresh step completion status
          queryClient.invalidateQueries({ queryKey: ["/api/wizards", wizardId] });
        } else if (data.type === 'error') {
          setError(data.message);
          setIsProcessing(false);
          eventSource.close();
        }
      };

      eventSource.onerror = () => {
        setError('Connection to processing server lost');
        setIsProcessing(false);
        eventSource.close();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
      setIsProcessing(false);
    }
  };

  const progressPercentage = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;

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
          {!isProcessing && !results && (
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
                data-testid="button-start-processing"
              >
                <Play className="mr-2 h-4 w-4" />
                Start Processing
              </Button>
            </div>
          )}

          {isProcessing && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm font-medium">
                  {mode === 'create' ? 'Creating workers...' : 'Updating workers...'}
                </span>
              </div>
              
              <Progress value={progressPercentage} className="h-2" />
              
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Processed</p>
                  <p className="text-lg font-semibold" data-testid="text-processed">
                    {progress.processed.toLocaleString()} / {progress.total.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Success</p>
                  <p className="text-lg font-semibold text-green-600" data-testid="text-success">
                    {progress.successCount.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Failed</p>
                  <p className="text-lg font-semibold text-red-600" data-testid="text-failed">
                    {progress.failureCount.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Processing Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {results && !isProcessing && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Processing Results</h3>
                {wizardStatus && (
                  <Badge variant={wizardStatus === 'complete' ? 'default' : 'secondary'}>
                    {wizardStatus === 'complete' ? 'Complete' : 'Needs Review'}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-2xl font-bold" data-testid="text-total-rows">
                        {results.totalRows.toLocaleString()}
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
                        <p className="text-2xl font-bold text-green-600" data-testid="text-success-count">
                          {results.successCount.toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {mode === 'create' ? 'Created' : 'Updated'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <XCircle className="h-5 w-5 text-red-600" />
                        <p className="text-2xl font-bold text-red-600" data-testid="text-failure-count">
                          {results.failureCount.toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">Failed</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {results.failureCount > 0 && results.errors.length > 0 && (
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
                        {results.errors.map((error, idx) => (
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

              {results.failureCount === 0 && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Processing Complete</AlertTitle>
                  <AlertDescription>
                    Successfully {mode === 'create' ? 'created' : 'updated'} {results.successCount.toLocaleString()} worker{results.successCount !== 1 ? 's' : ''}.
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
