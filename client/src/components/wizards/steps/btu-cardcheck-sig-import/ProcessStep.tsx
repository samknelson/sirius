import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Play, Loader2, FileSignature } from "lucide-react";
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
  errors: Array<{ filename: string; bpsId: string; error: string }>;
  processedFiles: Array<{
    filename: string;
    bpsId: string;
    workerId: string;
    workerName: string;
    action: string;
    esigId?: string;
    cardcheckId?: string;
  }>;
}

export function ProcessStep({ wizardId, wizardType, data, onDataChange }: ProcessStepProps) {
  const { toast } = useToast();
  const [results, setResults] = useState<ProcessResults | null>(data?.processResults || null);

  const previewData = data?.previewData;
  const matchedCount = previewData?.matchedCount || 0;

  const processMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/btu-sig-import/process", { wizardId });
    },
    onSuccess: (result: ProcessResults) => {
      setResults(result);
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Processing Complete",
        description: `Created ${result.created}, linked ${result.linked}, ${result.errors.length} errors.`,
      });
    },
    onError: (error: Error) => {
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
          <CardTitle>Process Signature Import</CardTitle>
          <CardDescription>
            Upload PDFs, create e-signature records, and link to card checks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!processMutation.isPending && !results && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <FileSignature className="h-12 w-12 text-muted-foreground" />
              <div className="text-center space-y-2">
                <p className="text-muted-foreground">
                  Ready to process {matchedCount} matched files
                </p>
                {previewData && previewData.unmatchedCount > 0 && (
                  <p className="text-sm text-amber-600">
                    Note: {previewData.unmatchedCount} unmatched files will be skipped
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
            <div className="space-y-4">
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <Progress value={50} className="h-2" />
              <p className="text-center text-sm text-muted-foreground">
                Processing signatures... This may take a few minutes.
              </p>
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
                <span className="text-lg font-medium">Processing Complete</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold">{results.total}</div>
                    <div className="text-sm text-muted-foreground">Total</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-green-600">{results.created}</div>
                    <div className="text-sm text-muted-foreground">Card Checks Created</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-blue-600">{results.linked}</div>
                    <div className="text-sm text-muted-foreground">E-Sigs Linked</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-red-600">{results.errors.length}</div>
                    <div className="text-sm text-muted-foreground">Errors</div>
                  </CardContent>
                </Card>
              </div>

              {results.errors.length > 0 && (
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
                              <span className="font-medium font-mono">{error.bpsId}:</span>{' '}
                              <span className="text-muted-foreground">{error.error}</span>
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
