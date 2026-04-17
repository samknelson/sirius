import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FacilityLayout, useFacilityLayout } from "@/components/layouts/FacilityLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Trash2 } from "lucide-react";
import { useAccessCheck } from "@/hooks/use-access-check";

function EditContent() {
  const { facility } = useFacilityLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { canAccess: isAdmin } = useAccessCheck("admin", facility.id);
  const [formData, setFormData] = useState({ name: "", siriusId: "" });

  useEffect(() => {
    setFormData({ name: facility.name, siriusId: facility.siriusId || "" });
  }, [facility.id, facility.name, facility.siriusId]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      apiRequest("PATCH", `/api/facilities/${facility.id}`, {
        name: data.name,
        siriusId: data.siriusId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/facilities", facility.id] });
      toast({ title: "Facility updated", description: "The facility has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/facilities/${facility.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
      toast({ title: "Facility deleted", description: `"${facility.name}" has been deleted.` });
      setLocation("/facilities");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    updateMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-edit">
        <CardHeader>
          <CardTitle>Edit Facility</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siriusId">Sirius ID</Label>
              <Input
                id="siriusId"
                value={formData.siriusId}
                onChange={(e) => setFormData((p) => ({ ...p, siriusId: e.target.value }))}
                placeholder="Optional external identifier"
                data-testid="input-edit-sirius-id"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={updateMutation.isPending || !formData.name} data-testid="button-save">
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/facilities/${facility.id}`)}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="border-destructive" data-testid="card-delete">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Delete this facility</p>
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
                    <AlertDialogTitle>Delete Facility</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{facility.name}"? This action cannot be undone.
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
        </Card>
      )}
    </div>
  );
}

export default function FacilityEditPage() {
  return (
    <FacilityLayout activeTab="edit">
      <EditContent />
    </FacilityLayout>
  );
}
