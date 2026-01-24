import { format } from "date-fns";
import { Link } from "wouter";
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
import { User, Briefcase, Calendar, Clock, Bell, Mail, MessageSquare, ExternalLink } from "lucide-react";
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

function DispatchDetailsContent() {
  const { dispatch } = useDispatchLayout();

  const workerName = dispatch.worker?.contact
    ? `${dispatch.worker.contact.given || ''} ${dispatch.worker.contact.family || ''}`.trim() || dispatch.worker.contact.displayName
    : dispatch.worker?.siriusId
      ? `Worker #${dispatch.worker.siriusId}`
      : 'Unknown Worker';

  return (
    <div className="space-y-6">
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
              <Link href={`/dispatch/job/${dispatch.jobId}`}>
                <p className="font-medium text-foreground hover:underline cursor-pointer" data-testid="link-job-title">
                  {dispatch.job.title}
                </p>
              </Link>
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
