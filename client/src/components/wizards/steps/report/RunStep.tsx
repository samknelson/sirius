import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Play, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface RunStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
}

export function RunStep({ wizardId, wizardType, data }: RunStepProps) {
  const { toast } = useToast();

  // Poll wizard status to get real progress
  const { data: wizard } = useQuery<any>({
    queryKey: [`/api/wizards/${wizardId}`],
    refetchInterval: (query) => {
      // Poll every second if the run step is actually in progress (percentComplete > 0)
      const wizardData = query.state.data;
      const runProgress = wizardData?.data?.progress?.run;
      const actuallyRunning = runProgress?.status === 'in_progress' && (runProgress?.percentComplete || 0) > 0;
      return actuallyRunning ? 1000 : false;
    },
  });

  const wizardData = wizard?.data || data;
  const runProgress = wizardData?.progress?.run;
  // Only consider it "generating" if status is in_progress AND percentComplete > 0
  // This prevents showing spinner when step is first entered (status is auto-set to in_progress)
  const isGenerating = runProgress?.status === 'in_progress' && (runProgress?.percentComplete || 0) > 0;
  const completed = runProgress?.status === 'completed';
  const error = runProgress?.error;
  const progress = runProgress?.percentComplete || 0;

  const wizardDisplayName = wizardType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const generateReportMutation = useMutation({
    mutationFn: async () => {
      try {
        // Mark run step as in progress first
        await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
          data: {
            progress: {
              run: {
                status: "in_progress",
                percentComplete: 0,
              },
            },
          },
        });

        // Trigger report generation (apiRequest already returns parsed JSON)
        // Backend will update progress to completed and save reportDataId
        const results = await apiRequest("POST", `/api/wizards/${wizardId}/generate-report`, {});
        
        return results;
      } catch (error) {
        // Mark run step as failed
        try {
          await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
            data: {
              progress: {
                run: {
                  status: "failed",
                  error: error instanceof Error ? error.message : "Failed to generate report",
                },
              },
            },
          });
        } catch (patchError) {
          // If PATCH fails, log but don't throw
          console.error("Failed to update wizard status:", patchError);
        }

        // Re-throw the original error to trigger onError
        throw error;
      }
    },
    onSuccess: async (results) => {
      // Backend already updated progress to completed, just invalidate queries
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      
      toast({
        title: "Report Generated",
        description: `Found ${results.recordCount || 0} record(s).`,
      });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      
      toast({
        title: "Error",
        description: error.message || "Failed to generate report",
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    generateReportMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Report</CardTitle>
        <CardDescription>
          Run the {wizardDisplayName} analysis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isGenerating && !completed && !error && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <Play className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm font-medium">Ready to Generate Report</p>
              <p className="text-sm text-muted-foreground">
                Click the button below to analyze all workers and generate the report
              </p>
            </div>
            <Button 
              onClick={handleGenerate}
              size="lg"
              data-testid="button-generate-report"
            >
              <Play className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </div>
        )}

        {isGenerating && (
          <div className="space-y-4">
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Generating report...</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
            <p className="text-sm text-center text-muted-foreground">
              Please wait while we analyze the data
            </p>
          </div>
        )}

        {completed && (
          <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              Report generated successfully! Click "Next" to view the results.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
