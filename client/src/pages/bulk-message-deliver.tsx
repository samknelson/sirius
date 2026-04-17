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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { TokenCoverageCard, type TokenCoverageResponse } from "@/components/bulk/TokenCoverageCard";
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
  Mail,
  MessageSquare,
  MapPin,
  Bell,
} from "lucide-react";

interface MediumStats {
  total: number;
  pending: number;
  sendFailed: number;
  seeComm: number;
}

interface DeliveryStats {
  total: number;
  pending: number;
  sendFailed: number;
  seeComm: number;
  commBreakdown: Record<string, number>;
  byMedium: Record<string, MediumStats>;
}

const commIcons: Record<string, typeof CheckCircle> = {
  sent: Send,
  delivered: CheckCircle,
  failed: XCircle,
  sending: Loader2,
};

const commColors: Record<string, string> = {
  sent: "text-blue-500",
  delivered: "text-green-500",
  failed: "text-red-500",
  sending: "text-yellow-500",
};

const mediumIcons: Record<string, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  postal: MapPin,
  inapp: Bell,
};

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  postal: "Postal",
  inapp: "In-App",
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

  const processed = stats.seeComm + stats.sendFailed;
  const commEntries = Object.entries(stats.commBreakdown).sort(
    ([a], [b]) => a.localeCompare(b)
  );
  const byMediumEntries = Object.entries(stats.byMedium || {});
  const commDelivered = stats.commBreakdown?.delivered ?? 0;
  const commFailed = Object.entries(stats.commBreakdown ?? {})
    .filter(([k]) => k !== "delivered")
    .reduce((sum, [, v]) => sum + (v as number), 0);
  const totalDelivered = commDelivered;
  const totalFailed = stats.sendFailed + commFailed;
  const inFlight = Math.max(0, stats.seeComm - commDelivered - commFailed);

  return (
    <Card data-testid="card-delivery-stats">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Delivery Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-5 gap-4">
          <div className="text-center" data-testid="stat-total">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="text-center" data-testid="stat-pending">
            <p className="text-2xl font-bold text-muted-foreground">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </div>
          <div className="text-center" data-testid="stat-in-flight">
            <p className="text-2xl font-bold text-amber-500">{inFlight}</p>
            <p className="text-xs text-muted-foreground">In Flight</p>
          </div>
          <div className="text-center" data-testid="stat-delivered">
            <p className="text-2xl font-bold text-blue-500">{totalDelivered}</p>
            <p className="text-xs text-muted-foreground">Delivered</p>
          </div>
          <div className="text-center" data-testid="stat-failed">
            <p className="text-2xl font-bold text-red-500">{totalFailed}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
        </div>

        {stats.total > 0 && (
          <div className="w-full bg-muted rounded-full h-2" data-testid="progress-bar">
            <div
              className="bg-primary rounded-full h-2 transition-all"
              style={{ width: `${Math.round((processed / stats.total) * 100)}%` }}
            />
          </div>
        )}

        {byMediumEntries.length > 1 && (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-medium">By Medium</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {byMediumEntries.map(([medium, ms]) => {
                  const Icon = mediumIcons[medium] || Mail;
                  const label = mediumLabels[medium] || medium;
                  const mProcessed = ms.seeComm + ms.sendFailed;
                  return (
                    <div
                      key={medium}
                      className="border rounded-md p-3 space-y-2"
                      data-testid={`stat-medium-${medium}`}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="h-4 w-4" />
                        {label}
                        <Badge variant="secondary" className="ml-auto text-xs">{ms.total}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
                        <span>Pending: {ms.pending}</span>
                        <span className="text-blue-500">Delivered: {ms.seeComm}</span>
                        <span className="text-red-500">Failed: {ms.sendFailed}</span>
                      </div>
                      {ms.total > 0 && (
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div
                            className="bg-primary rounded-full h-1.5 transition-all"
                            style={{ width: `${Math.round((mProcessed / ms.total) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {commEntries.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">Comm Status Breakdown</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {commEntries.map(([status, count]) => {
                  const Icon = commIcons[status] || AlertCircle;
                  const color = commColors[status] || "text-muted-foreground";
                  return (
                    <div
                      key={status}
                      className="flex items-center gap-2 text-sm"
                      data-testid={`stat-comm-${status}`}
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: coverage } = useQuery<TokenCoverageResponse>({
    queryKey: ["/api/bulk-messages", bulkMessage.id, "token-coverage"],
  });

  const statusMutation = useMutation({
    mutationFn: (update: { status: string; sendDate?: string | null }) => {
      return apiRequest("PATCH", `/api/bulk-messages/${bulkMessage.id}`, update);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "delivery-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "token-coverage"] });
      toast({ title: "Status updated", description: "The message status has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    },
  });

  const missingTokens = (coverage?.perToken || []).filter((t) => t.missingCount > 0);
  const totalMissing = missingTokens.reduce((sum, t) => sum + t.missingCount, 0);

  const queueNow = () => {
    statusMutation.mutate({
      status: "queued",
      sendDate: sendDate || null,
    });
  };

  const handleQueue = () => {
    if (missingTokens.length > 0) {
      setConfirmOpen(true);
      return;
    }
    queueNow();
  };

  const handleConfirmQueue = () => {
    setConfirmOpen(false);
    queueNow();
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

      <TokenCoverageCard messageId={bulkMessage.id} />

      <DeliveryStatsCard messageId={bulkMessage.id} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-missing-tokens">
          <AlertDialogHeader>
            <AlertDialogTitle>Some recipients are missing token data</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {totalMissing} recipient value{totalMissing === 1 ? " is" : "s are"} missing across{" "}
                  {missingTokens.length} token{missingTokens.length === 1 ? "" : "s"}. Affected recipients
                  will see each token's default value.
                </p>
                <ul className="text-sm list-disc pl-5">
                  {missingTokens.map((t) => (
                    <li key={t.tokenId} data-testid={`text-confirm-missing-${t.tokenId}`}>
                      <code className="text-xs">{`{{${t.tokenId}}}`}</code> — {t.missingCount} missing
                      {t.defaultValue ? ` (default: "${t.defaultValue}")` : " (no default)"}
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmQueue} data-testid="button-confirm-send-anyway">
              Queue anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
