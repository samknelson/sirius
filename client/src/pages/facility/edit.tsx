import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FacilityLayout, useFacilityLayout } from "@/components/layouts/FacilityLayout";
import { EntityNameManagement } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="space-y-6">
      <EntityNameManagement
        config={{
          entityId: facility.id,
          displayName: facility.contact.displayName,
          contactData: {
            title: facility.contact.title,
            given: facility.contact.given,
            middle: facility.contact.middle,
            family: facility.contact.family,
            generational: facility.contact.generational,
            credentials: facility.contact.credentials,
          },
          apiEndpoint: `/api/facilities/${facility.id}`,
          apiMethod: "PATCH",
          apiPayloadKey: "nameComponents",
          invalidateQueryKeys: [
            "/api/facilities",
            ["/api/facilities", facility.id],
            "/api/contacts",
          ],
          cardTitle: "Facility Name",
          cardDescription: "Manage the facility's name. This is kept in sync with the linked contact.",
        }}
      />

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
