import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Play, Loader2, Globe } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ProcessStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessResults {
  processed: number;
  total: number;
  created: number;
  linked: number;
  skipped: number;
  errors: Array<{ nid: string; bpsId: string; error: string }>;
  processedRows: Array<{
    nid: string;
    bpsId: string;
    workerId: string;
    workerName: string;
    action: string;
    esigId?: string;
    cardcheckId?: string;
  }>;
}

interface ProcessProgress {
  status: string;
  current: number;
  total: number;
  created: number;
  linked: number;
  errors: number;
  currentActivity: string;
}

export function ProcessStep({ wizardId, wizardType, data, onDataChange }: ProcessStepProps) {
  const { toast } = useToast();
  const [results, setResults] = useState<ProcessResults | null>(data?.processResults || null);
  const [isProcessing, setIsProcessing] = useState(false);

  const previewData = data?.previewData;
  const matchedCount = previewData?.matchedCount || 0;

  const { data: wizardData } = useQuery<{ data: { processProgress?: ProcessProgress } }>({
    queryKey: [`/api/wizards/${wizardId}`],
    refetchInterval: isProcessing ? 4000 : false,
  });

  const progress = wizardData?.data?.processProgress;
  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  const processMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/btu-scraper-import/process", { wizardId });
    },
    onMutate: () => {
      setIsProcessing(true);
    },
    onSuccess: (result: ProcessResults) => {
      setIsProcessing(false);
      setResults(result);
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Processing Complete",
        description: `Created ${result.created}, linked ${result.linked}, ${result.errors.length} errors.`,
      });
    },
    onError: (error: Error) => {
      setIsProcessing(false);
      toast({
        title: "Processing Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Process Scraper Import</CardTitle>
          <CardDescription>
            Generate PDFs from card check pages, create e-signature records, and link to card checks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!processMutation.isPending && !results && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Globe className="h-12 w-12 text-muted-foreground" />
              <div className="text-center space-y-2">
                <p className="text-muted-foreground" data-testid="text-process-prompt">
                  Ready to process {matchedCount} matched rows
                </p>
                {previewData && previewData.unmatchedCount > 0 && (
                  <p className="text-sm text-amber-600" data-testid="text-unmatched-note">
                    Note: {previewData.unmatchedCount} unmatched rows will be skipped
                  </p>
                )}
                {previewData && previewData.skippedCount > 0 && (
                  <p className="text-sm text-amber-600" data-testid="text-skipped-note">
                    Note: {previewData.skippedCount} rows already have uploaded e-signatures and will be skipped
                  </p>
                )}
              </div>
              <Button
                onClick={() => processMutation.mutate()}
                size="lg"
                className="gap-2"
                data-testid="button-start-processing"
              >
                <Play className="h-4 w-4" />
                Start Processing
              </Button>
            </div>
          )}

          {processMutation.isPending && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              {progress ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium" data-testid="text-process-activity">{progress.currentActivity}</span>
                    <span className="text-muted-foreground" data-testid="text-process-percent">{progressPercent}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
                    <div className="p-2 border rounded-md">
                      <div className="font-semibold" data-testid="text-progress-current">{progress.current} / {progress.total}</div>
                      <div className="text-xs text-muted-foreground">Processed</div>
                    </div>
                    <div className="p-2 border rounded-md">
                      <div className="font-semibold text-green-600" data-testid="text-progress-created">{progress.created}</div>
                      <div className="text-xs text-muted-foreground">Created</div>
                    </div>
                    <div className="p-2 border rounded-md">
                      <div className="font-semibold text-blue-600" data-testid="text-progress-linked">{progress.linked}</div>
                      <div className="text-xs text-muted-foreground">Linked</div>
                    </div>
                    <div className="p-2 border rounded-md">
                      <div className="font-semibold text-red-600" data-testid="text-progress-errors">{progress.errors}</div>
                      <div className="text-xs text-muted-foreground">Errors</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Progress updates every few seconds
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Progress value={0} className="h-2" />
                  <p className="text-center text-sm text-muted-foreground" data-testid="text-processing-starting">
                    Starting processing... Logging in to external site.
                  </p>
                </div>
              )}
            </div>
          )}

          {results && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {results.errors.length === 0 ? (
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                ) : (
                  <AlertCircle className="h-6 w-6 text-amber-600" />
                )}
                <span className="text-lg font-medium" data-testid="text-processing-complete">Processing Complete</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold" data-testid="text-result-total">{results.total}</div>
                  <div className="text-sm text-muted-foreground">Total</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold text-green-600" data-testid="text-result-created">{results.created}</div>
                  <div className="text-sm text-muted-foreground">Card Checks Created</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold text-blue-600" data-testid="text-result-linked">{results.linked}</div>
                  <div className="text-sm text-muted-foreground">E-Sigs Linked</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold text-red-600" data-testid="text-result-errors">{results.errors.length}</div>
                  <div className="text-sm text-muted-foreground">Errors</div>
                </div>
              </div>

              {results.errors.length > 0 && (
                <div className="border rounded-lg">
                  <div className="p-4 border-b">
                    <div className="text-sm font-medium">Processing Errors</div>
                  </div>
                  <ScrollArea className="h-48">
                    <div className="p-4 space-y-2">
                      {results.errors.map((error, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm" data-testid={`error-item-${idx}`}>
                          <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                          <div>
                            <span className="font-medium font-mono">{error.bpsId} (NID: {error.nid}):</span>{' '}
                            <span className="text-muted-foreground">{error.error}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
