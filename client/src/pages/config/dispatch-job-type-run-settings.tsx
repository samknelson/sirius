import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DispatchJobTypeLayout, useDispatchJobTypeLayout } from "@/components/layouts/DispatchJobTypeLayout";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import type { JobTypeData } from "@shared/schema";

function RunSettingsContent() {
  const { jobType } = useDispatchJobTypeLayout();
  const { toast } = useToast();

  const jobTypeData = jobType.data as JobTypeData | undefined;

  const [offerRatio, setOfferRatio] = useState<string>(jobTypeData?.offerRatio?.toString() ?? "");
  const [offerTimeout, setOfferTimeout] = useState<string>(jobTypeData?.offerTimeout?.toString() ?? "");

  useEffect(() => {
    setOfferRatio(jobTypeData?.offerRatio?.toString() ?? "");
    setOfferTimeout(jobTypeData?.offerTimeout?.toString() ?? "");
  }, [jobTypeData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updatedData: JobTypeData = {
        ...jobTypeData,
        offerRatio: offerRatio !== "" ? parseFloat(offerRatio) : undefined,
        offerTimeout: offerTimeout !== "" ? parseFloat(offerTimeout) : undefined,
      };
      return apiRequest("PUT", `/api/options/dispatch-job-type/${jobType.id}`, {
        name: jobType.name,
        description: jobType.description || "",
        data: updatedData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type", jobType.id] });
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

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-run-settings">Run Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
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
              placeholder="Not set"
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
              placeholder="Not set"
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

export default function DispatchJobTypeRunSettingsPage() {
  usePageTitle("Run Settings");
  return (
    <DispatchJobTypeLayout activeTab="run-settings">
      <RunSettingsContent />
    </DispatchJobTypeLayout>
  );
}
