import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Play, Loader2, FileCheck } from "lucide-react";

interface ProcessStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ rowIndex: number; message: string; data?: Record<string, any> }>;
  completedAt?: string;
  cardchecksCreated?: Array<{ bpsEmployeeId: string; workerName: string }>;
  skippedDuplicate?: Array<{ bpsEmployeeId: string; workerName: string }>;
  notFoundBpsIds?: Array<{ bpsEmployeeId: string; rowIndex: number }>;
}

export function ProcessStep({ wizardId, wizardType, data, onDataChange }: ProcessStepProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({
    processed: 0,
    total: 0,
    createdCount: 0,
    updatedCount: 0,
    successCount: 0,
    failureCount: 0,
  });
  const [results, setResults] = useState<ProcessResults | null>(data?.processResults || null);
  const [error, setError] = useState<string | null>(null);

  const validationResults = data?.validationResults;

  const checkWizardCompletion = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/wizards/${wizardId}`, { credentials: 'include' });
      if (!res.ok) return false;
      const wizardData = await res.json();
      const processResults = wizardData?.data?.processResults;
      const wizStatus = wizardData?.status;
      if (processResults && (wizStatus === 'completed' || wizStatus === 'needs_review')) {
        setResults(processResults);
        setIsProcessing(false);
        queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const pollForCompletion = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const done = await checkWizardCompletion();
      if (done) return;
    }
    setError('Processing is taking longer than expected. Please refresh the page to check the results.');
    setIsProcessing(false);
  };

  const startProcessing = async () => {
    setIsProcessing(true);
    setError(null);
    setProgress({ processed: 0, total: 0, createdCount: 0, updatedCount: 0, successCount: 0, failureCount: 0 });

    try {
      const eventSource = new EventSource(`/api/wizards/${wizardId}/process`, {
        withCredentials: true,
      });

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'progress') {
          setProgress((prev) => ({
            processed: data.processed !== undefined ? data.processed : prev.processed,
            total: data.total !== undefined ? data.total : prev.total,
            createdCount: data.createdCount !== undefined ? data.createdCount : prev.createdCount,
            updatedCount: data.updatedCount !== undefined ? data.updatedCount : prev.updatedCount,
            successCount: data.successCount !== undefined ? data.successCount : prev.successCount,
            failureCount: data.failureCount !== undefined ? data.failureCount : prev.failureCount,
          }));
        } else if (data.type === 'complete') {
          setResults(data.results);
          setIsProcessing(false);
          eventSource.close();
          queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
        } else if (data.type === 'error') {
          setError(data.message);
          setIsProcessing(false);
          eventSource.close();
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        pollForCompletion();
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
          <CardTitle>Process Card Check Import</CardTitle>
          <CardDescription>
            Create card check records for matched workers from the uploaded file
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isProcessing && !results && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <FileCheck className="h-12 w-12 text-muted-foreground" />
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
                className="gap-2"
                data-testid="button-start-processing"
              >
                <Play className="h-4 w-4" />
                Start Processing
              </Button>
            </div>
          )}

          {isProcessing && (
            <div className="space-y-4">
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <Progress value={progressPercentage} className="h-2" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">{progress.processed}</div>
                  <div className="text-sm text-muted-foreground">of {progress.total} Processed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">{progress.createdCount}</div>
                  <div className="text-sm text-muted-foreground">Created</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">{progress.updatedCount}</div>
                  <div className="text-sm text-muted-foreground">Duplicates Skipped</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">{progress.failureCount}</div>
                  <div className="text-sm text-muted-foreground">Not Found / Errors</div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {results && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {results.failureCount === 0 ? (
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
                    <div className="text-2xl font-bold">{results.totalRows.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Total Rows</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-green-600">{results.createdCount.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Card Checks Created</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-blue-600">{(results.skippedDuplicate?.length || results.updatedCount).toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Duplicates Skipped</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-red-600">{(results.notFoundBpsIds?.length || results.failureCount).toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Not Found / Errors</div>
                  </CardContent>
                </Card>
              </div>

              {results.errors && results.errors.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Processing Errors</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {results.errors.map((error, idx) => (
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
