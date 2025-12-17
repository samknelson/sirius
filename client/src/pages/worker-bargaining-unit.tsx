import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { BargainingUnit } from "@shared/schema";
import { Link } from "wouter";
import { ExternalLink } from "lucide-react";

function WorkerBargainingUnitContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [selectedBargainingUnitId, setSelectedBargainingUnitId] = useState<string>(
    worker.bargainingUnitId || ""
  );

  const { data: bargainingUnits = [], isLoading: isLoadingUnits } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const currentBargainingUnit = bargainingUnits.find(bu => bu.id === worker.bargainingUnitId);

  const updateMutation = useMutation({
    mutationFn: async (bargainingUnitId: string | null) => {
      return await apiRequest("PATCH", `/api/workers/${worker.id}`, {
        bargainingUnitId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id] });
      toast({
        title: "Success",
        description: "Bargaining unit updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update bargaining unit",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const newValue = selectedBargainingUnitId === "" ? null : selectedBargainingUnitId;
    updateMutation.mutate(newValue);
  };

  const hasChanges = (selectedBargainingUnitId || null) !== (worker.bargainingUnitId || null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bargaining Unit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bargaining-unit">Current Bargaining Unit</Label>
            {currentBargainingUnit ? (
              <div className="flex items-center gap-2">
                <span className="text-foreground font-medium" data-testid="text-current-bargaining-unit">
                  {currentBargainingUnit.name}
                </span>
                <Link href={`/bargaining-units/${currentBargainingUnit.id}`}>
                  <Button variant="ghost" size="sm" data-testid="button-view-bargaining-unit">
                    <ExternalLink size={14} />
                  </Button>
                </Link>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm" data-testid="text-no-bargaining-unit">
                No bargaining unit assigned
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="select-bargaining-unit">Change Bargaining Unit</Label>
            <Select
              value={selectedBargainingUnitId}
              onValueChange={setSelectedBargainingUnitId}
              disabled={isLoadingUnits}
            >
              <SelectTrigger data-testid="select-bargaining-unit">
                <SelectValue placeholder="Select a bargaining unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="" data-testid="option-no-bargaining-unit">
                  (None)
                </SelectItem>
                {bargainingUnits.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id} data-testid={`option-bargaining-unit-${unit.id}`}>
                    {unit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateMutation.isPending}
              data-testid="button-save-bargaining-unit"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            {hasChanges && (
              <Button
                variant="outline"
                onClick={() => setSelectedBargainingUnitId(worker.bargainingUnitId || "")}
                data-testid="button-cancel-bargaining-unit"
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

export default function WorkerBargainingUnit() {
  return (
    <WorkerLayout activeTab="bargaining-unit">
      <WorkerBargainingUnitContent />
    </WorkerLayout>
  );
}
