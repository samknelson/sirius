import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BargainingUnitLayout, useBargainingUnitLayout } from "@/components/layouts/BargainingUnitLayout";

function BargainingUnitDeleteContent() {
  const { bargainingUnit } = useBargainingUnitLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/bargaining-units/${bargainingUnit.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units"] });
      toast({
        title: "Success",
        description: "Bargaining unit deleted successfully.",
      });
      setLocation("/bargaining-units");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete bargaining unit.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-destructive/10 rounded-lg">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Bargaining Unit</h3>
            <p className="text-muted-foreground">
              Are you sure you want to delete the bargaining unit "{bargainingUnit.name}"? 
              This action cannot be undone.
            </p>
          </div>
        </div>

        <div className="bg-muted/50 p-4 rounded-lg">
          <h4 className="font-medium text-foreground mb-2">Details:</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><span className="font-medium">Name:</span> {bargainingUnit.name}</li>
            <li><span className="font-medium">Sirius ID:</span> {bargainingUnit.siriusId}</li>
          </ul>
        </div>

        <div className="flex items-center gap-2 pt-4">
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            data-testid="button-confirm-delete"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete Bargaining Unit
          </Button>
          <Button
            variant="outline"
            onClick={() => setLocation(`/bargaining-units/${bargainingUnit.id}`)}
            data-testid="button-cancel-delete"
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BargainingUnitDeletePage() {
  return (
    <BargainingUnitLayout activeTab="delete">
      <BargainingUnitDeleteContent />
    </BargainingUnitLayout>
  );
}
