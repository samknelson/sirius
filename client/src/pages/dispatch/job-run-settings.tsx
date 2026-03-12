import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import type { JobTypeData, DispatchJobData } from "@shared/schema";

function RunSettingsContent() {
  const { job } = useDispatchJobLayout();
  const { toast } = useToast();

  const jobData = job.data as DispatchJobData | undefined;
  const jobTypeData = job.jobType?.data as JobTypeData | undefined;

  const [offerRatio, setOfferRatio] = useState<string>(jobData?.offerRatio?.toString() ?? "");
  const [offerTimeout, setOfferTimeout] = useState<string>(jobData?.offerTimeout?.toString() ?? "");

  useEffect(() => {
    setOfferRatio(jobData?.offerRatio?.toString() ?? "");
    setOfferTimeout(jobData?.offerTimeout?.toString() ?? "");
  }, [jobData?.offerRatio, jobData?.offerTimeout]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updatedData: Record<string, unknown> = { ...(jobData || {}) };

      if (offerRatio !== "") {
        updatedData.offerRatio = parseFloat(offerRatio);
      } else {
        delete updatedData.offerRatio;
      }

      if (offerTimeout !== "") {
        updatedData.offerTimeout = parseFloat(offerTimeout);
      } else {
        delete updatedData.offerTimeout;
      }

      return apiRequest("PUT", `/api/dispatch-jobs/${job.id}`, {
        data: updatedData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs", job.id] });
      toast({
        title: "Saved",
        description: "Run settings updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save run settings.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (offerRatio !== "" && (isNaN(parseFloat(offerRatio)) || parseFloat(offerRatio) < 0)) {
      toast({ title: "Validation Error", description: "Offer ratio must be a non-negative number.", variant: "destructive" });
      return;
    }
    if (offerTimeout !== "" && (isNaN(parseFloat(offerTimeout)) || parseFloat(offerTimeout) < 0)) {
      toast({ title: "Validation Error", description: "Offer timeout must be a non-negative number.", variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  const hasJobTypeDefaults = jobTypeData?.offerRatio !== undefined || jobTypeData?.offerTimeout !== undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-run-settings">Run Settings</CardTitle>
        <CardDescription>
          Configure run settings for this specific job. Leave blank to use the job type defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasJobTypeDefaults && (
          <div className="text-sm text-muted-foreground p-3 border rounded-md space-y-1">
            <p className="font-medium">Job Type Defaults:</p>
            {jobTypeData?.offerRatio !== undefined && (
              <p>Offer Ratio: {jobTypeData.offerRatio}</p>
            )}
            {jobTypeData?.offerTimeout !== undefined && (
              <p>Offer Timeout: {jobTypeData.offerTimeout} minutes</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="offer-ratio">Offer Ratio</Label>
            <Input
              id="offer-ratio"
              type="number"
              min="0"
              step="any"
              value={offerRatio}
              onChange={(e) => setOfferRatio(e.target.value)}
              placeholder={jobTypeData?.offerRatio !== undefined ? `Default: ${jobTypeData.offerRatio}` : "Not set"}
              data-testid="input-offer-ratio"
            />
            <p className="text-sm text-muted-foreground">
              The ratio of offers to available slots. For example, 2.0 means twice as many offers as open slots.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offer-timeout">Offer Timeout (minutes)</Label>
            <Input
              id="offer-timeout"
              type="number"
              min="0"
              step="any"
              value={offerTimeout}
              onChange={(e) => setOfferTimeout(e.target.value)}
              placeholder={jobTypeData?.offerTimeout !== undefined ? `Default: ${jobTypeData.offerTimeout}` : "Not set"}
              data-testid="input-offer-timeout"
            />
            <p className="text-sm text-muted-foreground">
              The number of minutes after an offer is made before it expires.
            </p>
          </div>
        </div>

        <div>
          <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-run-settings">
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DispatchJobRunSettingsPage() {
  return (
    <DispatchJobLayout activeTab="run-settings">
      <RunSettingsContent />
    </DispatchJobLayout>
  );
}
