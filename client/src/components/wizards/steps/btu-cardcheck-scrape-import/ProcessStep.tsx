import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Play, Loader2, Globe, Info } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ProcessStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessProgress {
  status: string;
  current: number;
  total: number;
  created: number;
  skipped: number;
  errors: number;
  currentActivity: string;
}

export function ProcessStep({ wizardId, wizardType, data, onDataChange }: ProcessStepProps) {
  const { toast } = useToast();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processResults = data?.processResults || null;
  const processProgress: ProcessProgress | null = data?.processProgress || null;
  const isProcessing = processProgress?.status === 'processing';

  const { data: wizard } = useQuery<any>({
    queryKey: [`/api/wizards/${wizardId}`],
    refetchInterval: isProcessing || isStarting ? 5000 : false,
  });

  const { data: pendingData } = useQuery<{ count: number }>({
    queryKey: ['/api/btu-scraper-import/pending-count', { cardcheckDefinitionId: data?.cardcheckDefinitionId }],
    enabled: !!data?.cardcheckDefinitionId && !isProcessing && !processResults,
  });

  useEffect(() => {
    if (wizard?.data?.processResults && !processResults) {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    }
  }, [wizard?.data?.processResults]);

  const liveProgress = wizard?.data?.processProgress || processProgress;
  const liveIsProcessing = liveProgress?.status === 'processing';
  const progressPercent = liveProgress ? Math.round((liveProgress.current / liveProgress.total) * 100) : 0;

  const pendingCount = pendingData?.count || 0;
  const hasCompleted = !!processResults || wizard?.status === 'completed' || wizard?.status === 'completed_with_errors' || wizard?.status === 'error';
  const liveResults = wizard?.data?.processResults || processResults;

  const startProcessing = async () => {
    setIsStarting(true);
    setError(null);
    try {
      await apiRequest("POST", "/api/btu-scraper-import/process", { wizardId });
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start processing');
      setIsStarting(false);
    }
  };

  useEffect(() => {
    if (isStarting && (liveIsProcessing || hasCompleted)) {
      setIsStarting(false);
    }
  }, [isStarting, liveIsProcessing, hasCompleted]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Fetch Signature PDFs
          </CardTitle>
          <CardDescription>
            Fetch PDF signatures from the external BTU site for card checks that have a NID but are missing a signature
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!liveIsProcessing && !isStarting && !hasCompleted && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Globe className="h-12 w-12 text-muted-foreground" />
              <div className="text-center space-y-2">
                <p className="text-lg font-medium" data-testid="text-pending-count">
                  {pendingCount} card check{pendingCount !== 1 ? 's' : ''} need{pendingCount === 1 ? 's' : ''} signature PDFs
                </p>
                <p className="text-sm text-muted-foreground">
                  These are card checks with a NID from the import but no attached signature PDF yet.
                </p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Background Processing</AlertTitle>
                <AlertDescription>
                  Processing runs in the background. You can safely leave this page and you'll receive
                  a notification when it's done.
                </AlertDescription>
              </Alert>

              <Button
                onClick={startProcessing}
                size="lg"
                className="gap-2"
                disabled={pendingCount === 0}
                data-testid="button-start-processing"
              >
                <Play className="h-4 w-4" />
                Start Fetching PDFs
              </Button>
            </div>
          )}

          {(liveIsProcessing || isStarting) && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              {liveProgress && liveProgress.total > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium" data-testid="text-process-activity">{liveProgress.currentActivity}</span>
                    <span className="text-muted-foreground" data-testid="text-process-percent">{progressPercent}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
                    <div className="p-2 border rounded-md">
                      <div className="font-semibold" data-testid="text-progress-current">{liveProgress.current} / {liveProgress.total}</div>
                      <div className="text-xs text-muted-foreground">Processed</div>
                    </div>
                    <div className="p-2 border rounded-md">
                      <div className="font-semibold text-green-600" data-testid="text-progress-created">{liveProgress.created}</div>
                      <div className="text-xs text-muted-foreground">PDFs Fetched</div>
                    </div>
                    <div className="p-2 border rounded-md">
                      <div className="font-semibold text-amber-600" data-testid="text-progress-skipped">{liveProgress.skipped}</div>
                      <div className="text-xs text-muted-foreground">Skipped</div>
                    </div>
                    <div className="p-2 border rounded-md">
                      <div className="font-semibold text-red-600" data-testid="text-progress-errors">{liveProgress.errors}</div>
                      <div className="text-xs text-muted-foreground">Errors</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Processing in background. You can safely leave this page.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Progress value={0} className="h-2" />
                  <p className="text-center text-sm text-muted-foreground" data-testid="text-processing-starting">
                    Starting... Logging in to the external site.
                  </p>
                </div>
              )}
            </div>
          )}

          {hasCompleted && liveResults && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {liveResults.errors?.length === 0 ? (
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                ) : (
                  <AlertCircle className="h-6 w-6 text-amber-600" />
                )}
                <span className="text-lg font-medium" data-testid="text-processing-complete">Processing Complete</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold" data-testid="text-result-total">{liveResults.total}</div>
                  <div className="text-sm text-muted-foreground">Total</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold text-green-600" data-testid="text-result-created">{liveResults.created}</div>
                  <div className="text-sm text-muted-foreground">PDFs Fetched</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold text-amber-600" data-testid="text-result-skipped">{liveResults.skipped}</div>
                  <div className="text-sm text-muted-foreground">Skipped</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold text-red-600" data-testid="text-result-errors">{liveResults.errors?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Errors</div>
                </div>
              </div>

              {liveResults.errors?.length > 0 && (
                <div className="border rounded-lg">
                  <div className="p-4 border-b">
                    <div className="text-sm font-medium">Processing Errors</div>
                  </div>
                  <ScrollArea className="h-48">
                    <div className="p-4 space-y-2">
                      {liveResults.errors.map((error: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-2 text-sm" data-testid={`error-item-${idx}`}>
                          <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                          <div>
                            <span className="font-medium font-mono">NID {error.sourceNid || error.cardcheckId}:</span>{' '}
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

          {hasCompleted && data?.processError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Processing Failed</AlertTitle>
              <AlertDescription>{data.processError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
