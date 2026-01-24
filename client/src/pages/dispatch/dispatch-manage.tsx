import { useState } from "react";
import { DispatchLayout, useDispatchLayout } from "@/components/layouts/DispatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Save, Settings, AlertCircle, Loader2 } from "lucide-react";
import { dispatchStatusEnum, type DispatchStatus } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<string, string> = {
  requested: "Requested",
  pending: "Pending",
  notified: "Notified",
  accepted: "Accepted",
  layoff: "Layoff",
  resigned: "Resigned",
  declined: "Declined",
};

function DispatchManageContent() {
  const { dispatch } = useDispatchLayout();
  const { toast } = useToast();
  const [selectedStatus, setSelectedStatus] = useState<DispatchStatus>(dispatch.status as DispatchStatus);
  const [error, setError] = useState<string | null>(null);

  const setStatusMutation = useMutation({
    mutationFn: async (newStatus: DispatchStatus) => {
      const response = await apiRequest("POST", `/api/dispatches/${dispatch.id}/set-status`, { status: newStatus });
      return response.json();
    },
    onSuccess: () => {
      setError(null);
      toast({
        title: "Status updated",
        description: `Dispatch status changed to ${statusLabels[selectedStatus] || selectedStatus}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatches", dispatch.id] });
    },
    onError: async (err: any) => {
      let message = "Failed to update status";
      if (err?.message) {
        message = err.message;
      }
      setError(message);
    },
  });

  const handleSave = () => {
    setError(null);
    setStatusMutation.mutate(selectedStatus);
  };

  const hasChanged = selectedStatus !== dispatch.status;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="title-manage-section">
            <Settings className="h-5 w-5" />
            Manage Dispatch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive" data-testid="alert-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription data-testid="text-error-message">{error}</AlertDescription>
            </Alert>
          )}

          <div className="max-w-xs space-y-2">
            <Label htmlFor="status-select" data-testid="label-status">Status</Label>
            <Select value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as DispatchStatus)}>
              <SelectTrigger id="status-select" data-testid="select-status">
                <SelectValue placeholder="Select status" data-testid="text-selected-status" />
              </SelectTrigger>
              <SelectContent>
                {dispatchStatusEnum.map((status) => (
                  <SelectItem key={status} value={status} data-testid={`option-status-${status}`}>
                    {statusLabels[status] || status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4">
            <Button 
              onClick={handleSave} 
              disabled={!hasChanged || setStatusMutation.isPending}
              data-testid="button-save"
            >
              {setStatusMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DispatchManagePage() {
  return (
    <DispatchLayout activeTab="manage">
      <DispatchManageContent />
    </DispatchLayout>
  );
}
