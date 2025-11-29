import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { WorkerHoursLayout, useWorkerHoursLayout } from "@/components/layouts/WorkerHoursLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface LedgerNotification {
  type: "created" | "updated" | "deleted";
  amount: string;
  description: string;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

function getMonthName(month: number): string {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return monthNames[month - 1];
}

function WorkerHoursDeleteContent() {
  const { hoursEntry } = useWorkerHoursLayout();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const showLedgerNotifications = (notifications: LedgerNotification[] | undefined) => {
    if (!notifications || notifications.length === 0) return;
    
    for (const notification of notifications) {
      const typeLabel = notification.type === "created" ? "Ledger Entry Created" :
                        notification.type === "updated" ? "Ledger Entry Updated" :
                        "Ledger Entry Deleted";
      
      toast({
        title: typeLabel,
        description: `${formatCurrency(notification.amount)} - ${notification.description}`,
      });
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/worker-hours/${hoursEntry.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete hours entry");
      }
      return response.status === 204 ? null : response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", hoursEntry.workerId, "hours"] });
      toast({ title: "Success", description: "Hours entry deleted successfully" });
      if (data) {
        showLedgerNotifications(data.ledgerNotifications);
      }
      setLocation(`/workers/${hoursEntry.workerId}/employment/daily`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete hours entry",
        variant: "destructive",
      });
    },
  });

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle size={20} />
          Delete Hours Entry
        </CardTitle>
        <CardDescription>
          This action cannot be undone. This will permanently delete the hours entry.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-muted/50 rounded-lg p-4 space-y-4">
          <h4 className="font-medium text-foreground">Entry to be deleted:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Date</label>
              <p className="mt-1" data-testid="text-delete-date">
                {getMonthName(hoursEntry.month)} {hoursEntry.day}, {hoursEntry.year}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Employer</label>
              <p className="mt-1" data-testid="text-delete-employer">
                {hoursEntry.employer?.name || "Unknown"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Employment Status</label>
              <p className="mt-1" data-testid="text-delete-employment-status">
                {hoursEntry.employmentStatus?.name || "Unknown"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Hours</label>
              <p className="mt-1 font-mono" data-testid="text-delete-hours">
                {hoursEntry.hours !== null ? hoursEntry.hours.toFixed(2) : "-"}
              </p>
            </div>
            {hoursEntry.home && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Home</label>
                <div className="mt-1">
                  <Badge variant="default" data-testid="badge-delete-home">Home</Badge>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            data-testid="button-confirm-delete"
          >
            <Trash2 size={16} className="mr-2" />
            {deleteMutation.isPending ? "Deleting..." : "Delete Hours Entry"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkerHoursDelete() {
  return (
    <WorkerHoursLayout activeTab="delete">
      <WorkerHoursDeleteContent />
    </WorkerHoursLayout>
  );
}
