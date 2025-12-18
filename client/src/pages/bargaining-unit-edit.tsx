import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BargainingUnitLayout, useBargainingUnitLayout } from "@/components/layouts/BargainingUnitLayout";

function BargainingUnitEditContent() {
  const { bargainingUnit } = useBargainingUnitLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [editName, setEditName] = useState(bargainingUnit.name);
  const [editSiriusId, setEditSiriusId] = useState(bargainingUnit.siriusId);

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string; siriusId: string }) => {
      return await apiRequest("PUT", `/api/bargaining-units/${bargainingUnit.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units", bargainingUnit.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units"] });
      toast({
        title: "Success",
        description: "Bargaining unit updated successfully!",
      });
      setLocation(`/bargaining-units/${bargainingUnit.id}`);
    },
    onError: (error: any) => {
      const message = error.message || "Failed to update bargaining unit. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSaveEdit = () => {
    if (!editName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }

    if (!editSiriusId.trim()) {
      toast({
        title: "Validation Error",
        description: "Sirius ID is required.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      name: editName.trim(),
      siriusId: editSiriusId.trim(),
    });
  };

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Edit Bargaining Unit</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-sm font-medium text-foreground">
                Name *
              </Label>
              <Input
                id="edit-name"
                type="text"
                placeholder="Enter bargaining unit name..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full"
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-sirius-id" className="text-sm font-medium text-foreground">
                Sirius ID *
              </Label>
              <Input
                id="edit-sirius-id"
                type="text"
                placeholder="Enter Sirius ID..."
                value={editSiriusId}
                onChange={(e) => setEditSiriusId(e.target.value)}
                className="w-full"
                data-testid="input-edit-sirius-id"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-4">
          <Button
            onClick={handleSaveEdit}
            disabled={updateMutation.isPending}
            data-testid="button-save-edit"
          >
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Button
            variant="outline"
            onClick={() => setLocation(`/bargaining-units/${bargainingUnit.id}`)}
            data-testid="button-cancel-edit"
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BargainingUnitEditPage() {
  return (
    <BargainingUnitLayout activeTab="edit">
      <BargainingUnitEditContent />
    </BargainingUnitLayout>
  );
}
