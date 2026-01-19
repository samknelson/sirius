import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface Industry {
  id: string;
  name: string;
  code: string | null;
  siriusId: string | null;
}

const NONE_VALUE = "__none__";

function WorkerIndustryContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [selectedIndustryId, setSelectedIndustryId] = useState<string>(
    worker.industryId || NONE_VALUE
  );

  const { data: industries = [], isLoading: isLoadingIndustries } = useQuery<Industry[]>({
    queryKey: ["/api/options/industry"],
  });

  const currentIndustry = industries.find(ind => ind.id === worker.industryId);

  const updateMutation = useMutation({
    mutationFn: async (industryId: string | null) => {
      return await apiRequest("PATCH", `/api/workers/${worker.id}`, {
        industryId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id] });
      toast({
        title: "Success",
        description: "Industry updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update industry",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const newValue = selectedIndustryId === NONE_VALUE ? null : selectedIndustryId;
    updateMutation.mutate(newValue);
  };

  const currentValue = worker.industryId || NONE_VALUE;
  const hasChanges = selectedIndustryId !== currentValue;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Industry</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="industry">Current Industry</Label>
            {currentIndustry ? (
              <span className="text-foreground font-medium" data-testid="text-current-industry">
                {currentIndustry.name}
              </span>
            ) : (
              <p className="text-muted-foreground text-sm" data-testid="text-no-industry">
                No industry assigned
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="select-industry">Change Industry</Label>
            <Select
              value={selectedIndustryId}
              onValueChange={setSelectedIndustryId}
              disabled={isLoadingIndustries}
            >
              <SelectTrigger data-testid="select-industry">
                <SelectValue placeholder="Select an industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE} data-testid="option-no-industry">
                  (None)
                </SelectItem>
                {industries.map((industry) => (
                  <SelectItem key={industry.id} value={industry.id} data-testid={`option-industry-${industry.id}`}>
                    {industry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateMutation.isPending}
              data-testid="button-save-industry"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            {hasChanges && (
              <Button
                variant="outline"
                onClick={() => setSelectedIndustryId(worker.industryId || NONE_VALUE)}
                data-testid="button-cancel-industry"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkerIndustry() {
  return (
    <WorkerLayout activeTab="industry">
      <WorkerIndustryContent />
    </WorkerLayout>
  );
}
