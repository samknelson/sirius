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
import type { WorkerDispatchStatus } from "@shared/schema";

function DispatchStatusContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
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

  const upsertMutation = useMutation({
    mutationFn: async (data: { status: string; seniorityDate: string | null }) => {
      return apiRequest("PUT", `/api/worker-dispatch-status/worker/${worker.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-status/worker", worker.id] });
      toast({
        title: "Dispatch status updated",
        description: "The worker's dispatch status has been saved.",
      });
      setIsEditing(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update dispatch status.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    setEditStatus(dispatchStatus?.status || "available");
    setEditSeniorityDate(dispatchStatus?.seniorityDate ? format(new Date(dispatchStatus.seniorityDate), "yyyy-MM-dd") : "");
    setIsEditing(true);
  };

  const handleSave = () => {
    upsertMutation.mutate({
      status: editStatus,
      seniorityDate: editSeniorityDate || null,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
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
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            <CardTitle>Dispatch Status</CardTitle>
          </div>
          {!isEditing && (
            <Button variant="outline" size="sm" onClick={handleEdit} data-testid="button-edit-dispatch-status">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
        <CardDescription>
          Manage this worker's availability for dispatch jobs and seniority date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger id="status" data-testid="select-dispatch-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="not_available">Not Available</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="seniority-date">Seniority Date</Label>
              <Input
                id="seniority-date"
                type="date"
                value={editSeniorityDate}
                onChange={(e) => setEditSeniorityDate(e.target.value)}
                data-testid="input-seniority-date"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={upsertMutation.isPending} data-testid="button-save-dispatch-status">
                <Save className="h-4 w-4 mr-2" />
                {upsertMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={handleCancel} disabled={upsertMutation.isPending} data-testid="button-cancel-dispatch-status">
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-sm">Status</Label>
              <div>
                {dispatchStatus ? (
                  <Badge variant={statusBadgeVariant} data-testid="badge-dispatch-status">
                    {dispatchStatus.status === "available" ? "Available" : "Not Available"}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground" data-testid="text-no-status">Not set</span>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-sm">Seniority Date</Label>
              <div className="flex items-center gap-2" data-testid="text-seniority-date">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                {dispatchStatus?.seniorityDate ? (
                  <span>{format(new Date(dispatchStatus.seniorityDate), "MMMM d, yyyy")}</span>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </div>
            </div>
          </div>
        )}
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
