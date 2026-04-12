import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Send,
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Users,
  RotateCcw,
  Pause,
} from "lucide-react";

interface DeliveryStats {
  total: number;
  sent: number;
  pending: number;
  statusBreakdown: Record<string, number>;
}

const statusIcons: Record<string, typeof CheckCircle> = {
  sent: Send,
  delivered: CheckCircle,
  failed: XCircle,
  sending: Loader2,
  unknown: AlertCircle,
};

const statusColors: Record<string, string> = {
  sent: "text-blue-500",
  delivered: "text-green-500",
  failed: "text-red-500",
  sending: "text-yellow-500",
  unknown: "text-muted-foreground",
};

function DeliveryStatsCard({ messageId }: { messageId: string }) {
  const { data: stats, isLoading } = useQuery<DeliveryStats>({
    queryKey: ["/api/bulk-messages", messageId, "delivery-stats"],
  });

  if (isLoading) {
    return (
      <Card data-testid="card-delivery-stats">
        <CardContent className="flex items-center justify-center h-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const breakdownEntries = Object.entries(stats.statusBreakdown).sort(
    ([a], [b]) => a.localeCompare(b)
  );

  return (
    <Card data-testid="card-delivery-stats">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Delivery Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center" data-testid="stat-total">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Recipients</p>
          </div>
          <div className="text-center" data-testid="stat-sent">
            <p className="text-2xl font-bold text-blue-500">{stats.sent}</p>
            <p className="text-xs text-muted-foreground">Sent</p>
          </div>
          <div className="text-center" data-testid="stat-pending">
            <p className="text-2xl font-bold text-muted-foreground">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </div>
        </div>

        {stats.total > 0 && (
          <div className="w-full bg-muted rounded-full h-2" data-testid="progress-bar">
            <div
              className="bg-primary rounded-full h-2 transition-all"
              style={{ width: `${Math.round((stats.sent / stats.total) * 100)}%` }}
            />
          </div>
        )}

        {breakdownEntries.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">Status Breakdown</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {breakdownEntries.map(([status, count]) => {
                  const Icon = statusIcons[status] || AlertCircle;
                  const color = statusColors[status] || "text-muted-foreground";
                  return (
                    <div
                      key={status}
                      className="flex items-center gap-2 text-sm"
                      data-testid={`stat-breakdown-${status}`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${color}`} />
                      <span className="capitalize">{status}</span>
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {count}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {stats.total === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No recipients have been added yet. Add recipients in the Recipients tab before delivering.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function BulkMessageDeliverContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sendDate, setSendDate] = useState("");

  const statusMutation = useMutation({
    mutationFn: (update: { status: string; sendDate?: string | null }) => {
      return apiRequest("PATCH", `/api/bulk-messages/${bulkMessage.id}`, update);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "delivery-stats"] });
      toast({ title: "Status updated", description: "The message status has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    },
  });

  const handleQueue = () => {
    statusMutation.mutate({
      status: "queued",
      sendDate: sendDate || null,
    });
  };

  const handleCancel = () => {
    statusMutation.mutate({ status: "draft", sendDate: null });
  };

  const handleMarkSent = () => {
    statusMutation.mutate({ status: "sent" });
  };

  const handleResetToDraft = () => {
    statusMutation.mutate({ status: "draft", sendDate: null });
  };

  const scheduledDate = bulkMessage.sendDate
    ? new Date(bulkMessage.sendDate).toLocaleDateString()
    : undefined;
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-6">
      <Card data-testid="card-bulk-deliver">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Delivery Controls
            <Badge
              variant={bulkMessage.status === "sent" ? "default" : bulkMessage.status === "queued" ? "outline" : "secondary"}
              className="ml-2"
            >
              {bulkMessage.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {bulkMessage.status === "draft" && (
            <div className="space-y-4" data-testid="section-draft">
              <p className="text-sm text-muted-foreground">
                Queue this message for delivery. You can optionally set a future send date.
              </p>
              <div className="flex items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sendDate">Send Date (optional)</Label>
                  <Input
                    id="sendDate"
                    type="date"
                    value={sendDate}
                    onChange={(e) => setSendDate(e.target.value)}
                    min={today}
                    className="w-48"
                    data-testid="input-send-date"
                  />
                </div>
                <Button
                  onClick={handleQueue}
                  disabled={statusMutation.isPending || (!!sendDate && sendDate <= today)}
                  data-testid="button-queue"
                >
                  {statusMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4 mr-2" />
                  )}
                  Queue for Delivery
                </Button>
              </div>
              {sendDate && sendDate <= today && (
                <p className="text-sm text-destructive">Send date must be in the future.</p>
              )}
            </div>
          )}

          {bulkMessage.status === "queued" && (
            <div className="space-y-4" data-testid="section-queued">
              {scheduledDate && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Scheduled for:</span>
                  <span className="font-medium">{scheduledDate}</span>
                </div>
              )}
              {!scheduledDate && (
                <p className="text-sm text-muted-foreground">
                  This message is queued for delivery (no specific send date set).
                </p>
              )}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={statusMutation.isPending}
                  data-testid="button-cancel-queue"
                >
                  {statusMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Pause className="h-4 w-4 mr-2" />
                  )}
                  Cancel
                </Button>
                <Button
                  onClick={handleMarkSent}
                  disabled={statusMutation.isPending}
                  data-testid="button-mark-sent"
                >
                  {statusMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-2" />
                  )}
                  Mark Sent
                </Button>
              </div>
            </div>
          )}

          {bulkMessage.status === "sent" && (
            <div className="space-y-4" data-testid="section-sent">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>This message has been marked as sent.</span>
              </div>
              <Button
                variant="outline"
                onClick={handleResetToDraft}
                disabled={statusMutation.isPending}
                data-testid="button-reset-draft"
              >
                {statusMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Reset to Draft
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <DeliveryStatsCard messageId={bulkMessage.id} />
    </div>
  );
}

export default function BulkMessageDeliverPage() {
  return (
    <BulkMessageLayout activeTab="deliver">
      <BulkMessageDeliverContent />
    </BulkMessageLayout>
  );
}
