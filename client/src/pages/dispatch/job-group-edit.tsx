import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DispatchJobGroupLayout, useDispatchJobGroupLayout } from "@/components/layouts/DispatchJobGroupLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Trash2 } from "lucide-react";
import { useAccessCheck } from "@/hooks/use-access-check";

function EditContent() {
  const { group } = useDispatchJobGroupLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { canAccess: isAdmin } = useAccessCheck("admin", group.id);
  const [formData, setFormData] = useState({
    name: "",
    startYmd: "",
    endYmd: "",
  });

  useEffect(() => {
    if (group) {
      setFormData({
        name: group.name,
        startYmd: group.startYmd,
        endYmd: group.endYmd,
      });
    }
  }, [group]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const payload = {
        name: data.name,
        startYmd: data.startYmd,
        endYmd: data.endYmd,
      };
      return apiRequest("PUT", `/api/dispatch-job-groups/${group.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-groups", group.id] });
      toast({ title: "Job group updated", description: "The job group has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/dispatch-job-groups/${group.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-groups"] });
      toast({ title: "Job group deleted", description: `"${group.name}" has been deleted.` });
      setLocation("/dispatch/job_groups");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.startYmd || !formData.endYmd) {
      toast({ title: "Validation error", description: "Name, start date, and end date are required.", variant: "destructive" });
      return;
    }
    updateMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-edit">
        <CardHeader>
          <CardTitle>Edit Job Group</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                data-testid="input-edit-name"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startYmd">Start Date</Label>
                <Input
                  id="startYmd"
                  type="date"
                  value={formData.startYmd}
                  onChange={(e) => setFormData((prev) => ({ ...prev, startYmd: e.target.value }))}
                  data-testid="input-edit-start-ymd"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endYmd">End Date</Label>
                <Input
                  id="endYmd"
                  type="date"
                  value={formData.endYmd}
                  onChange={(e) => setFormData((prev) => ({ ...prev, endYmd: e.target.value }))}
                  data-testid="input-edit-end-ymd"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !formData.name}
                data-testid="button-save"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/dispatch/job_group/${group.id}`)}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isAdmin && <Card className="border-destructive" data-testid="card-delete">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Delete this job group</p>
              <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleteMutation.isPending} data-testid="button-delete">
                  {deleteMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Job Group</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{group.name}"? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-delete"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>}
    </div>
  );
}

export default function DispatchJobGroupEditPage() {
  return (
    <DispatchJobGroupLayout activeTab="edit">
      <EditContent />
    </DispatchJobGroupLayout>
  );
}
