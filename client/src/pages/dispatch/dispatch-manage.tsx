import { useState, useMemo } from "react";
import { DispatchLayout, useDispatchLayout } from "@/components/layouts/DispatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Settings, AlertCircle, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { type DispatchStatus } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<string, string> = {
  pending: "Pending",
  notified: "Notified",
  accepted: "Accepted",
  layoff: "Layoff",
  resigned: "Resigned",
  declined: "Declined",
};

interface StatusOption {
  status: DispatchStatus;
  possible: boolean;
  reason?: string;
}

function DispatchManageContent() {
  const { dispatch } = useDispatchLayout();
  const { toast } = useToast();
  const [selectedStatus, setSelectedStatus] = useState<DispatchStatus>(dispatch.status as DispatchStatus);
  const [error, setError] = useState<string | null>(null);

  const { data: statusOptions, isLoading: isLoadingOptions } = useQuery<StatusOption[]>({
    queryKey: ["/api/dispatches", dispatch.id, "status-options"],
    queryFn: async () => {
      const response = await fetch(`/api/dispatches/${dispatch.id}/status-options`);
      if (!response.ok) throw new Error("Failed to fetch status options");
      return response.json();
    },
  });

  const possibleStatuses = useMemo(() => {
    if (!statusOptions) return [];
    return statusOptions.filter(opt => opt.possible).map(opt => opt.status);
  }, [statusOptions]);

  const setStatusMutation = useMutation({
    mutationFn: async (newStatus: DispatchStatus) => {
      return apiRequest("POST", `/api/dispatches/${dispatch.id}/set-status`, { status: newStatus });
    },
    onSuccess: () => {
      setError(null);
      toast({
        title: "Status updated",
        description: `Dispatch status changed to ${statusLabels[selectedStatus] || selectedStatus}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatches", dispatch.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatches", dispatch.id, "status-options"] });
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
  const canSave = hasChanged && possibleStatuses.includes(selectedStatus);

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
            {isLoadingOptions ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as DispatchStatus)}>
                <SelectTrigger id="status-select" data-testid="select-status">
                  <SelectValue placeholder="Select status" data-testid="text-selected-status" />
                </SelectTrigger>
                <SelectContent>
                  {possibleStatuses.map((status) => (
                    <SelectItem key={status} value={status} data-testid={`option-status-${status}`}>
                      {statusLabels[status] || status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="pt-4">
            <Button 
              onClick={handleSave} 
              disabled={!canSave || setStatusMutation.isPending}
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

      <Card>
        <CardHeader>
          <CardTitle data-testid="title-status-summary">Status Transition Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingOptions ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : statusOptions ? (
            <Table data-testid="table-status-options">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Available</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statusOptions.map((option) => (
                  <TableRow key={option.status} data-testid={`row-status-${option.status}`}>
                    <TableCell data-testid={`cell-available-${option.status}`}>
                      {option.possible ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                      )}
                    </TableCell>
                    <TableCell data-testid={`cell-status-${option.status}`}>
                      <Badge 
                        variant={option.status === dispatch.status ? "default" : "outline"}
                        className={option.status === dispatch.status ? "" : ""}
                      >
                        {statusLabels[option.status] || option.status}
                      </Badge>
                      {option.status === dispatch.status && (
                        <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm" data-testid={`cell-reason-${option.status}`}>
                      {option.possible ? "Available" : option.reason || "Not available"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground">Failed to load status options</p>
          )}
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
