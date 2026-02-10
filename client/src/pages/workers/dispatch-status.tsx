import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { format } from "date-fns";
import { Calendar, Truck, Edit, Save, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { WorkerDispatchStatus } from "@shared/schema";

function DispatchStatusContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const isStaff = hasPermission("staff");

  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [isEditingSeniority, setIsEditingSeniority] = useState(false);
  const [editStatus, setEditStatus] = useState<string>("available");
  const [editSeniorityDate, setEditSeniorityDate] = useState<string>("");

  const { data: dispatchStatus, isLoading } = useQuery<WorkerDispatchStatus>({
    queryKey: ["/api/worker-dispatch-status/worker", worker.id],
    queryFn: async () => {
      const response = await fetch(`/api/worker-dispatch-status/worker/${worker.id}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch dispatch status");
      }
      return response.json();
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      return apiRequest("PUT", `/api/worker-dispatch-status/worker/${worker.id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-status/worker", worker.id] });
      toast({ title: "Status updated", description: "Dispatch status has been saved." });
      setIsEditingStatus(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update dispatch status.", variant: "destructive" });
    },
  });

  const seniorityMutation = useMutation({
    mutationFn: async (seniorityDate: string | null) => {
      return apiRequest("PUT", `/api/worker-dispatch-status/worker/${worker.id}/seniority-date`, { seniorityDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-status/worker", worker.id] });
      toast({ title: "Seniority date updated", description: "The seniority date has been saved." });
      setIsEditingSeniority(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update seniority date.", variant: "destructive" });
    },
  });

  const handleEditStatus = () => {
    setEditStatus(dispatchStatus?.status || "available");
    setIsEditingStatus(true);
  };

  const handleSaveStatus = () => {
    statusMutation.mutate(editStatus);
  };

  const handleEditSeniority = () => {
    setEditSeniorityDate(
      dispatchStatus?.seniorityDate
        ? format(new Date(dispatchStatus.seniorityDate), "yyyy-MM-dd")
        : ""
    );
    setIsEditingSeniority(true);
  };

  const handleSaveSeniority = () => {
    seniorityMutation.mutate(editSeniorityDate || null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const statusBadgeVariant = dispatchStatus?.status === "available" ? "default" : "secondary";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5" />
          <CardTitle>Dispatch Status</CardTitle>
        </div>
        <CardDescription>
          Manage dispatch availability and seniority date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Label className="text-muted-foreground text-sm">Status</Label>
            {!isEditingStatus && (
              <Button variant="outline" size="sm" onClick={handleEditStatus} data-testid="button-edit-status">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
          {isEditingStatus ? (
            <div className="space-y-3">
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger data-testid="select-dispatch-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="not_available">Not Available</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveStatus} disabled={statusMutation.isPending} data-testid="button-save-status">
                  <Save className="h-4 w-4 mr-2" />
                  {statusMutation.isPending ? "Saving..." : "Save"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsEditingStatus(false)} disabled={statusMutation.isPending} data-testid="button-cancel-status">
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              {dispatchStatus ? (
                <Badge variant={statusBadgeVariant} data-testid="badge-dispatch-status">
                  {dispatchStatus.status === "available" ? "Available" : "Not Available"}
                </Badge>
              ) : (
                <span className="text-muted-foreground" data-testid="text-no-status">Not set</span>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Label className="text-muted-foreground text-sm">Seniority Date</Label>
            {!isEditingSeniority && isStaff && (
              <Button variant="outline" size="sm" onClick={handleEditSeniority} data-testid="button-edit-seniority">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
          {isEditingSeniority ? (
            <div className="space-y-3">
              <Input
                type="date"
                value={editSeniorityDate}
                onChange={(e) => setEditSeniorityDate(e.target.value)}
                data-testid="input-seniority-date"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveSeniority} disabled={seniorityMutation.isPending} data-testid="button-save-seniority">
                  <Save className="h-4 w-4 mr-2" />
                  {seniorityMutation.isPending ? "Saving..." : "Save"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsEditingSeniority(false)} disabled={seniorityMutation.isPending} data-testid="button-cancel-seniority">
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2" data-testid="text-seniority-date">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {dispatchStatus?.seniorityDate ? (
                <span>{format(new Date(dispatchStatus.seniorityDate), "MMMM d, yyyy")}</span>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkerDispatchStatusPage() {
  return (
    <WorkerLayout activeTab="dispatch-status">
      <DispatchStatusContent />
    </WorkerLayout>
  );
}
