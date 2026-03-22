import { useState } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DispatchLayout, useDispatchLayout } from "@/components/layouts/DispatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  User, Briefcase, Calendar, Clock, Bell, Mail, MessageSquare,
  ExternalLink, CheckCircle, XCircle, Pause, LogOut, Send, RotateCcw, Loader2,
  type LucideIcon,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { DispatchStatus } from "@shared/schema";
import type { CommSummary } from "../../../../server/storage/dispatches";

const statusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  notified: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  accepted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  layoff: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  resigned: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  declined: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const commStatusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  queued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  sent: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  delivered: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  bounced: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

interface StatusOption {
  status: DispatchStatus;
  possible: boolean;
  reason?: string;
}

interface StatusActionConfig {
  label: string;
  description: string;
  confirmTitle: string;
  confirmDescription: string;
  icon: LucideIcon;
  variant: "default" | "destructive" | "outline" | "secondary";
  className: string;
}

const statusActionConfig: Record<string, StatusActionConfig> = {
  pending: {
    label: "Reset to Pending",
    description: "Move this dispatch back to pending status",
    confirmTitle: "Reset to Pending?",
    confirmDescription: "This will reset the dispatch status back to pending. The worker will need to be notified again.",
    icon: RotateCcw,
    variant: "outline",
    className: "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800",
  },
  notified: {
    label: "Send Notification",
    description: "Mark this worker as notified about the dispatch",
    confirmTitle: "Mark as Notified?",
    confirmDescription: "This will update the dispatch status to notified, indicating the worker has been informed about this job.",
    icon: Send,
    variant: "outline",
    className: "border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-300 dark:hover:bg-blue-950",
  },
  accepted: {
    label: "Accept This Dispatch",
    description: "Confirm the worker for this job",
    confirmTitle: "Accept This Dispatch?",
    confirmDescription: "This will confirm the worker for this job. Their dispatch status will be set to accepted.",
    icon: CheckCircle,
    variant: "default",
    className: "bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-800",
  },
  declined: {
    label: "Decline This Dispatch",
    description: "The worker has declined this dispatch",
    confirmTitle: "Decline This Dispatch?",
    confirmDescription: "This will mark the dispatch as declined, indicating the worker has chosen not to accept this job.",
    icon: XCircle,
    variant: "destructive",
    className: "",
  },
  layoff: {
    label: "Record Layoff",
    description: "Record that this worker has been laid off from the dispatch",
    confirmTitle: "Record Layoff?",
    confirmDescription: "This will mark the dispatch as a layoff, indicating the worker is no longer assigned to this job.",
    icon: Pause,
    variant: "outline",
    className: "border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-600 dark:text-orange-300 dark:hover:bg-orange-950",
  },
  resigned: {
    label: "Record Resignation",
    description: "Record that this worker has resigned from the dispatch",
    confirmTitle: "Record Resignation?",
    confirmDescription: "This will mark the dispatch as resigned, indicating the worker has voluntarily left this job.",
    icon: LogOut,
    variant: "outline",
    className: "border-yellow-400 text-yellow-700 hover:bg-yellow-50 dark:border-yellow-600 dark:text-yellow-300 dark:hover:bg-yellow-950",
  },
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function getMediumIcon(medium: string) {
  const normalizedMedium = medium.toLowerCase().replace(/[-_]/g, '');
  switch (normalizedMedium) {
    case 'email':
      return <Mail className="h-4 w-4" />;
    case 'sms':
      return <MessageSquare className="h-4 w-4" />;
    case 'inapp':
      return <Bell className="h-4 w-4" />;
    default:
      return <Bell className="h-4 w-4" />;
  }
}

function getMediumLabel(medium: string): string {
  const normalizedMedium = medium.toLowerCase().replace(/[-_]/g, '');
  switch (normalizedMedium) {
    case 'email':
      return 'Email';
    case 'sms':
      return 'SMS';
    case 'inapp':
      return 'In-App';
    default:
      return medium;
  }
}

function StatusTransitionActions({ dispatchId, currentStatus }: { dispatchId: string; currentStatus: string }) {
  const { toast } = useToast();
  const [confirmingStatus, setConfirmingStatus] = useState<DispatchStatus | null>(null);

  const { data: statusOptions, isLoading, isError } = useQuery<StatusOption[]>({
    queryKey: ["/api/dispatches", dispatchId, "status-options"],
    queryFn: async () => {
      const response = await fetch(`/api/dispatches/${dispatchId}/status-options`);
      if (!response.ok) throw new Error("Failed to fetch status options");
      return response.json();
    },
  });

  const setStatusMutation = useMutation({
    mutationFn: async (newStatus: DispatchStatus) => {
      return apiRequest("POST", `/api/dispatches/${dispatchId}/set-status`, { status: newStatus });
    },
    onSuccess: (_data, newStatus) => {
      const config = statusActionConfig[newStatus];
      toast({
        title: "Status updated",
        description: `Dispatch status changed to ${config ? formatStatus(newStatus) : newStatus}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatches", dispatchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatches", dispatchId, "status-options"] });
      setConfirmingStatus(null);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update status",
        description: err?.message || "An error occurred while updating the dispatch status.",
        variant: "destructive",
      });
      setConfirmingStatus(null);
    },
  });

  const availableActions = (statusOptions || [])
    .filter(opt => opt.possible && opt.status !== currentStatus)
    .map(opt => opt.status)
    .filter(status => statusActionConfig[status]);

  if (isLoading) return null;

  if (isError) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-destructive" data-testid="text-status-options-error">
            Unable to load available status transitions.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (availableActions.length === 0) return null;

  const confirmConfig = confirmingStatus ? statusActionConfig[confirmingStatus] : null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base" data-testid="title-actions-section">
            Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3" data-testid="dispatch-action-buttons">
            {availableActions.map((status) => {
              const config = statusActionConfig[status];
              const Icon = config.icon;
              return (
                <Button
                  key={status}
                  variant={config.variant}
                  size="lg"
                  className={`gap-3 h-auto py-3 px-5 text-left ${config.className}`}
                  onClick={() => setConfirmingStatus(status)}
                  disabled={setStatusMutation.isPending}
                  data-testid={`button-action-${status}`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <div className="flex flex-col items-start">
                    <span className="text-base font-medium leading-tight">{config.label}</span>
                    <span className="text-xs font-normal opacity-80 leading-tight">{config.description}</span>
                  </div>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmingStatus} onOpenChange={(open) => { if (!open) setConfirmingStatus(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-status">
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-confirm-title">
              {confirmConfig?.confirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription data-testid="text-confirm-description">
              {confirmConfig?.confirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={setStatusMutation.isPending}
              data-testid="button-confirm-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmingStatus) {
                  setStatusMutation.mutate(confirmingStatus);
                }
              }}
              disabled={setStatusMutation.isPending}
              className={confirmConfig?.variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              data-testid="button-confirm-action"
            >
              {setStatusMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {confirmConfig?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DispatchDetailsContent() {
  const { dispatch } = useDispatchLayout();

  const workerName = dispatch.worker?.contact
    ? `${dispatch.worker.contact.given || ''} ${dispatch.worker.contact.family || ''}`.trim() || dispatch.worker.contact.displayName
    : dispatch.worker?.siriusId
      ? `Worker #${dispatch.worker.siriusId}`
      : 'Unknown Worker';

  return (
    <div className="space-y-6">
      <StatusTransitionActions dispatchId={dispatch.id} currentStatus={dispatch.status} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base" data-testid="title-status-section">
              <Clock className="h-4 w-4" />
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={statusColors[dispatch.status] || statusColors.pending} data-testid="badge-dispatch-status">
              {formatStatus(dispatch.status)}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base" data-testid="title-worker-section">
              <User className="h-4 w-4" />
              Worker
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {dispatch.worker ? (
                <Link href={`/workers/${dispatch.workerId}`}>
                  <p className="font-medium text-foreground hover:underline cursor-pointer" data-testid="link-worker-name">
                    {workerName}
                  </p>
                </Link>
              ) : (
                <p className="font-medium text-muted-foreground" data-testid="text-worker-name">
                  {workerName}
                </p>
              )}
              {dispatch.worker?.siriusId && (
                <p className="font-mono text-sm text-muted-foreground" data-testid="text-sirius-id">#{dispatch.worker.siriusId}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base" data-testid="title-job-section">
              <Briefcase className="h-4 w-4" />
              Job
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dispatch.job ? (
              <div className="space-y-1">
                <Link href={`/dispatch/job/${dispatch.jobId}`}>
                  <p className="font-medium text-foreground hover:underline cursor-pointer" data-testid="link-job-title">
                    {dispatch.job.title}
                  </p>
                </Link>
                {dispatch.job.payRate != null && (
                  <p className="text-sm text-muted-foreground" data-testid="text-pay-rate">
                    Pay Rate: ${parseFloat(dispatch.job.payRate).toFixed(2)}
                  </p>
                )}
              </div>
            ) : (
              <p className="font-medium text-muted-foreground" data-testid="text-job-title">
                Unknown Job
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base" data-testid="title-dates-section">
              <Calendar className="h-4 w-4" />
              Dates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <div>
                <span className="text-muted-foreground text-xs">Start</span>
                <p className="font-medium text-sm" data-testid="text-start-date">
                  {dispatch.startDate
                    ? format(new Date(dispatch.startDate), "MMM d, yyyy")
                    : "Not set"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">End</span>
                <p className="font-medium text-sm" data-testid="text-end-date">
                  {dispatch.endDate
                    ? format(new Date(dispatch.endDate), "MMM d, yyyy")
                    : "Not set"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="title-notifications-section">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!dispatch.comms || dispatch.comms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8" data-testid="empty-state-notifications">
              <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-3">
                <Bell className="text-muted-foreground" size={24} />
              </div>
              <p className="text-muted-foreground text-center text-sm" data-testid="text-no-notifications">
                No notifications have been sent for this dispatch.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medium</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead className="w-16">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatch.comms.map((comm: CommSummary) => (
                  <TableRow key={comm.id} data-testid={`row-comm-${comm.id}`}>
                    <TableCell data-testid={`text-medium-${comm.id}`}>
                      <div className="flex items-center gap-2">
                        {getMediumIcon(comm.medium)}
                        <span>{getMediumLabel(comm.medium)}</span>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-status-${comm.id}`}>
                      <Badge className={commStatusColors[comm.status] || commStatusColors.pending}>
                        {formatStatus(comm.status)}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-sent-${comm.id}`}>
                      {comm.sent
                        ? format(new Date(comm.sent), "MMM d, yyyy h:mm a")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Link href={`/comm/${comm.id}`}>
                        <Button variant="ghost" size="icon" data-testid={`button-view-comm-${comm.id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DispatchDetailsPage() {
  return (
    <DispatchLayout activeTab="details">
      <DispatchDetailsContent />
    </DispatchLayout>
  );
}
