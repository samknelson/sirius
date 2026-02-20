import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, Play, Loader2, Users } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ProcessStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessResults {
  total: number;
  processed: number;
  created: number;
  skipped: number;
  alreadyAssigned: number;
  errors: Array<{ name: string; badgeId: string; error: string }>;
  createdAssignments: Array<{
    name: string;
    badgeId: string;
    workerId: string;
    employerName: string;
    bargainingUnitName: string;
    assignmentId: string;
  }>;
}

export function ProcessStep({ wizardId, wizardType, data, onDataChange }: ProcessStepProps) {
  const { toast } = useToast();
  const [results, setResults] = useState<ProcessResults | null>(data?.processResults || null);

  const previewData = data?.previewData;
  const toCreateCount = previewData?.toCreateCount || 0;

  const processMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/btu-building-rep-import/process", { wizardId });
    },
    onSuccess: (result: ProcessResults) => {
      setResults(result);
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Processing Complete",
        description: `Created ${result.created} steward assignments.`,
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
          <CardTitle>Process Building Rep Import</CardTitle>
          <CardDescription>
            Create steward assignments for matched workers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!processMutation.isPending && !results && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Users className="h-12 w-12 text-muted-foreground" />
              <div className="text-center space-y-2">
                <p className="text-muted-foreground">
                  Ready to create {toCreateCount} steward assignment{toCreateCount !== 1 ? 's' : ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  Workers will be assigned as building representatives at their current employer
                </p>
              </div>
              <Button
                onClick={() => processMutation.mutate()}
                disabled={toCreateCount === 0}
                data-testid="button-process"
              >
                <Play className="h-4 w-4 mr-2" />
                Create Assignments
              </Button>
            </div>
          )}

          {processMutation.isPending && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">Processing assignments...</p>
            </div>
          )}

          {results && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Processing Complete</AlertTitle>
              <AlertDescription>
                Created {results.created} steward assignment{results.created !== 1 ? 's' : ''}.
                {results.skipped > 0 && ` Skipped ${results.skipped} (already assigned).`}
                {results.errors.length > 0 && ` ${results.errors.length} error(s).`}
              </AlertDescription>
            </Alert>
          )}

          {processMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{processMutation.error.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
