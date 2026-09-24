import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CommLayout } from "@/components/layouts/CommLayout";
import { useCommTabAccess } from "@/hooks/useTabAccess";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, WifiOff } from "lucide-react";
import { CommWithDetails } from "@/lib/comm-types";
import { CommDetailContent } from "@/components/comm/CommDetailContent";

export default function CommDetail() {
  const { commId } = useParams<{ commId: string }>();
  const { toast } = useToast();
  const [isOfflineConfirmOpen, setIsOfflineConfirmOpen] = useState(false);

  const { data: comm } = useQuery<CommWithDetails>({
    queryKey: ["/api/comm", commId],
    enabled: !!commId,
  });

  const { tabs } = useCommTabAccess(commId);
  const canEdit = tabs.some((t) => t.id === "edit");

  const markOfflineMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", `/api/comm/${commId}`, { status: "offline" });
    },
    onSuccess: () => {
      toast({
        title: "Marked as offline mailed",
        description: "The status was updated to offline.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/comm", commId] });
      if (comm?.contactId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/contacts", comm.contactId, "comm"],
        });
      }
      setIsOfflineConfirmOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update status",
        description: getApiErrorMessage(error, "An unexpected error occurred."),
        variant: "destructive",
      });
    },
  });

  const statusAction =
    canEdit &&
    comm?.medium === "postal" &&
    (comm.status === "queued" || comm.status === "sending") ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOfflineConfirmOpen(true)}
        data-testid="button-mark-offline-mailed"
      >
        <WifiOff className="w-3 h-3 mr-1" />
        Mark as offline mailed
      </Button>
    ) : null;

  return (
    <CommLayout activeTab="details">
      <CommDetailContent
        commId={commId}
        statusAction={statusAction}
        renderFallback={({ isLoading }) =>
          isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading communication details...
            </div>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                  <p className="text-muted-foreground">Communication record not found.</p>
                  <Button variant="outline" className="mt-4" asChild>
                    <Link href="/">
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Go Back
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        }
      />

      <AlertDialog open={isOfflineConfirmOpen} onOpenChange={setIsOfflineConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-offline-mailed">
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as offline mailed?</AlertDialogTitle>
            <AlertDialogDescription>
              This sets the status to "offline", meaning the comm was delivered
              out-of-band (e.g. printed and dropped in the mail). Delivery
              state will be unverifiable afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-offline-mailed">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                markOfflineMutation.mutate();
              }}
              disabled={markOfflineMutation.isPending}
              data-testid="button-confirm-offline-mailed"
            >
              {markOfflineMutation.isPending ? "Saving..." : "Mark as offline mailed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommLayout>
  );
}
