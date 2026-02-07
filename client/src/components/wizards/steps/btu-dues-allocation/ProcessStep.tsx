import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Play, Loader2, DollarSign } from "lucide-react";

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
  const [wizardStatus, setWizardStatus] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const validationResults = data?.validationResults;
  const accountId = data?.accountId;
  const selectedAccount = accounts.find((a: any) => a.id === accountId);

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
          setWizardStatus(data.wizardStatus);
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
          <CardTitle>Process Dues Allocation</CardTitle>
          <CardDescription>
            Create ledger entries for dues deductions from the validated file
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isProcessing && !results && (
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
                  <div className="text-sm text-muted-foreground">Entries Created</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">{progress.successCount}</div>
                  <div className="text-sm text-muted-foreground">Successful</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">{progress.failureCount}</div>
                  <div className="text-sm text-muted-foreground">Errors</div>
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
                    <div className="text-sm text-muted-foreground">Entries Created</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-blue-600">{results.successCount.toLocaleString()}</div>
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
                {results.failureCount > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-red-600">{results.failureCount.toLocaleString()}</div>
                      <div className="text-sm text-muted-foreground">Errors</div>
                    </CardContent>
                  </Card>
                )}
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
