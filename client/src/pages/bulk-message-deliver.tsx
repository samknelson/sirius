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
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { invalidateMailCsvQueries, requestMailCsv } from "@/lib/bulk-mail-csv";
import { TokenCoverageCard, type TokenCoverageResponse } from "@/components/bulk/TokenCoverageCard";
import { getCommStatusBucket } from "@shared/commStatus";
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
  Download,
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
  commBreakdown?: Record<string, number>;
}

interface DeliveryStats {
  total: number;
  pending: number;
  sendFailed: number;
  seeComm: number;
  commBreakdown: Record<string, number>;
  byMedium: Record<string, MediumStats>;
}

interface MailCsvFeedback {
  kind: "download" | "no-file" | "error";
  exportedCount: number;
  blockedCount: number;
  missingAddressCount: number;
  message?: string;
}

function summarizeCommBreakdown(breakdown: Record<string, number> = {}) {
  return Object.entries(breakdown).reduce(
    (totals, [status, count]) => {
      const numericCount = Number(count) || 0;
      const bucket = getCommStatusBucket(status);
      if (bucket === "success") totals.successful += numericCount;
      else if (bucket === "error") totals.errors += numericCount;
      else if (status === "offline") totals.offline += numericCount;
      else totals.pending += numericCount;
      return totals;
    },
    { successful: 0, errors: 0, offline: 0, pending: 0 },
  );
}

const commIcons: Record<string, typeof CheckCircle> = {
  queued: Clock,
  sent: Send,
  delivered: CheckCircle,
  received: CheckCircle,
  read: CheckCircle,
  failed: XCircle,
  undelivered: XCircle,
  offline: Clock,
  sending: Loader2,
};

const commColors: Record<string, string> = {
  queued: "text-muted-foreground",
  sent: "text-blue-500",
  delivered: "text-green-500",
  received: "text-green-500",
  read: "text-green-500",
  failed: "text-red-500",
  undelivered: "text-red-500",
  offline: "text-amber-500",
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

  const overall = summarizeCommBreakdown(stats.commBreakdown);
  const processed = overall.successful + overall.errors + overall.offline + stats.sendFailed;
  const commEntries = Object.entries(stats.commBreakdown).sort(
    ([a], [b]) => a.localeCompare(b)
  );
  const byMediumEntries = Object.entries(stats.byMedium || {});
  const inFlight = overall.pending;

  return (
    <Card data-testid="card-delivery-stats">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Delivery Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
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
            <p className="text-xs text-muted-foreground">In progress</p>
          </div>
          <div className="text-center" data-testid="stat-successful">
            <p className="text-2xl font-bold text-blue-500" data-testid="stat-successful-count">{overall.successful}</p>
            <p className="text-xs text-muted-foreground">Sent / confirmed</p>
          </div>
          <div className="text-center" data-testid="stat-offline-completed">
            <p className="text-2xl font-bold text-muted-foreground" data-testid="stat-offline-count">{overall.offline}</p>
            <p className="text-xs text-muted-foreground">Completed offline</p>
          </div>
          <div className="text-center" data-testid="stat-failed">
            <p className="text-2xl font-bold text-red-500" data-testid="stat-error-count">{overall.errors + stats.sendFailed}</p>
            <p className="text-xs text-muted-foreground">Errors</p>
          </div>
        </div>
        {overall.offline > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-offline-not-delivered">
            Completed offline means the mailing list was prepared; it does not confirm physical delivery.
          </p>
        )}

        {stats.total > 0 && (
          <div className="w-full bg-muted rounded-full h-2" data-testid="progress-bar">
            <div
              className="bg-primary rounded-full h-2 transition-all"
              style={{ width: `${Math.min(100, Math.round((processed / stats.total) * 100))}%` }}
            />
          </div>
        )}

        {byMediumEntries.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-medium">By Medium</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {byMediumEntries.map(([medium, ms]) => {
                  const Icon = mediumIcons[medium] || Mail;
                  const label = mediumLabels[medium] || medium;
                  const mediumStats = summarizeCommBreakdown(ms.commBreakdown);
                  const mProcessed = mediumStats.successful + mediumStats.errors + mediumStats.offline + ms.sendFailed;
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
                      <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                        <span>Pending: {ms.pending}</span>
                        <span className="text-amber-500">In progress: {mediumStats.pending}</span>
                        <span className="text-blue-500">Sent / confirmed: {mediumStats.successful}</span>
                        <span>Completed offline: {mediumStats.offline}</span>
                        <span className="text-red-500">Errors: {mediumStats.errors + ms.sendFailed}</span>
                      </div>
                      {ms.total > 0 && (
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div
                            className="bg-primary rounded-full h-1.5 transition-all"
                            style={{ width: `${Math.min(100, Math.round((mProcessed / ms.total) * 100))}%` }}
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
  const [mailCsvLoading, setMailCsvLoading] = useState(false);
  const [mailCsvMode, setMailCsvMode] = useState<"outstanding" | "all">("outstanding");
  const [mailCsvFeedback, setMailCsvFeedback] = useState<MailCsvFeedback | null>(null);
  const isOfflinePostal =
    (bulkMessage.data as { offline?: boolean } | null)?.offline === true &&
    (Array.isArray(bulkMessage.medium) ? bulkMessage.medium : [bulkMessage.medium]).includes("postal");
  const hasOtherMedia = bulkMessage.medium.some(medium => medium !== "postal");
  const showQueueControls = !isOfflinePostal || hasOtherMedia;

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
      toast({ title: "Failed to update status", description: getApiErrorMessage(error, "An unexpected error occurred"), variant: "destructive" });
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

  const handleDownloadMailCsv = async () => {
    setMailCsvLoading(true);
    setMailCsvFeedback(null);
    toast({ title: "Preparing mail CSV", description: "Collecting postal recipient details…" });
    try {
      const result = await requestMailCsv(
        `/api/bulk-messages/${bulkMessage.id}/mail-csv`,
        mailCsvMode,
      );
      if (result.kind === "no-file") {
        setMailCsvFeedback({
          kind: "no-file",
          exportedCount: 0,
          blockedCount: result.blockedCount,
          missingAddressCount: result.missingAddressCount,
          message: result.message,
        });
        toast({
          title: result.blockedCount > 0 ? "No recipients exported" : "No mailing list to download",
          description: result.message,
          ...(result.blockedCount > 0 ? { variant: "destructive" as const } : {}),
        });
        return;
      }

      const blobUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = (result.filename || `${bulkMessage.name || "bulk-message"}-mail.csv`)
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-+|-+$/g, "");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

      setMailCsvFeedback({
        kind: "download",
        exportedCount: result.recipientCount,
        blockedCount: result.blockedCount,
        missingAddressCount: result.missingAddressCount,
      });
      toast({
        title: "Mailing list downloaded",
        description: `${result.recipientCount} postal recipient${result.recipientCount === 1 ? "" : "s"} exported.${result.blockedCount > 0 ? ` ${result.blockedCount} blocked recipient${result.blockedCount === 1 ? "" : "s"} remain errors.` : ""}${result.missingAddressCount > 0 ? ` ${result.missingAddressCount} recipient${result.missingAddressCount === 1 ? "" : "s"} have missing address information.` : ""}`,
      });
    } catch (error) {
      const message = getApiErrorMessage(error, "Please try again.");
      setMailCsvFeedback({
        kind: "error",
        exportedCount: 0,
        blockedCount: 0,
        missingAddressCount: 0,
        message,
      });
      toast({
        title: "Could not download mailing list",
        description: message,
        variant: "destructive",
      });
    } finally {
      // The server may already have completed the message if the browser failed
      // while receiving/saving its response. Always refresh the authoritative state.
      invalidateMailCsvQueries(queryClient, bulkMessage.id);
      setMailCsvLoading(false);
    }
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
          {isOfflinePostal && (
            <div className="space-y-4" data-testid="section-offline-postal">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  A successful CSV download marks the message as sent and the included postal recipients as completed. This is not proof of physical delivery; blocked recipients remain errors.
                  {hasOtherMedia ? " Other media are not included and must be handled separately." : " Only postal recipients are included."}
                </AlertDescription>
              </Alert>
              <div className="space-y-2 max-w-sm">
                <Label htmlFor="mail-csv-mode">Recipients to include</Label>
                <select
                  id="mail-csv-mode"
                  value={mailCsvMode}
                  onChange={(event) => setMailCsvMode(event.target.value as "outstanding" | "all")}
                  disabled={mailCsvLoading}
                  data-testid="select-mail-csv-mode"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="outstanding">Only recipients not yet mailed</option>
                  <option value="all">All recipients (re-download)</option>
                </select>
              </div>
              <Button
                onClick={handleDownloadMailCsv}
                disabled={mailCsvLoading}
                data-testid="button-download-mail-csv"
              >
                {mailCsvLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {mailCsvLoading ? "Preparing CSV…" : "Download mail CSV"}
              </Button>
              {mailCsvFeedback && (
                <Alert
                  data-testid="feedback-mail-csv"
                  variant={mailCsvFeedback.kind === "error" || mailCsvFeedback.blockedCount > 0 ? "destructive" : "default"}
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {mailCsvFeedback.kind === "download" ? (
                      <div className="space-y-1">
                        <p>
                          {mailCsvFeedback.exportedCount} exported
                          {mailCsvFeedback.blockedCount > 0 && ` · ${mailCsvFeedback.blockedCount} blocked (remain errors)`}
                          {mailCsvFeedback.missingAddressCount > 0 && ` · ${mailCsvFeedback.missingAddressCount} with missing address information`}
                        </p>
                        {mailCsvFeedback.blockedCount > 0 && (
                          <a className="underline underline-offset-2" href={`/bulk/${bulkMessage.id}/recipients/list`}>
                            Review recipients
                          </a>
                        )}
                      </div>
                    ) : mailCsvFeedback.kind === "no-file" ? (
                      <div className="space-y-1">
                        <p>
                          {mailCsvFeedback.message}
                          {mailCsvFeedback.blockedCount > 0 && ` ${mailCsvFeedback.blockedCount} blocked recipient${mailCsvFeedback.blockedCount === 1 ? "" : "s"} remain errors.`}
                          {mailCsvFeedback.missingAddressCount > 0 && ` ${mailCsvFeedback.missingAddressCount} recipient${mailCsvFeedback.missingAddressCount === 1 ? "" : "s"} have missing address information.`}
                        </p>
                        {mailCsvFeedback.blockedCount > 0 && (
                          <a className="underline underline-offset-2" href={`/bulk/${bulkMessage.id}/recipients/list`}>
                            Review recipients
                          </a>
                        )}
                      </div>
                    ) : (
                      <p>{mailCsvFeedback.message}</p>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          {showQueueControls && bulkMessage.status === "draft" && (
            <div className="space-y-4" data-testid="section-draft">
              <p className="text-sm text-muted-foreground">
                {isOfflinePostal
                  ? "Queue the other media for delivery. Postal recipients are handled only by the CSV download above."
                  : "Queue this message for delivery. You can optionally set a future send date."}
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

          {showQueueControls && bulkMessage.status === "queued" && (
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

          {showQueueControls && bulkMessage.status === "sent" && (
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
