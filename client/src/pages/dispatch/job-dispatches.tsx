import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, Eye, User, Mail, MessageSquare, Bell, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DispatchWithRelations, CommSummary } from "../../../../server/storage/dispatches";

const statusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  notified: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  accepted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  layoff: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  resigned: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  declined: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

const commStatusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  delivered: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  read: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
};

const mediumIcons: Record<string, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  inapp: Bell,
};

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  inapp: "In-App",
};

function NotificationCell({ comms }: { comms?: CommSummary[] }) {
  if (!comms || comms.length === 0) {
    return <span className="text-muted-foreground text-sm">-</span>;
  }

  const byMedium = new Map<string, CommSummary>();
  for (const c of comms) {
    const existing = byMedium.get(c.medium);
    if (!existing) {
      byMedium.set(c.medium, c);
    } else {
      const existingTime = existing.sent ? new Date(existing.sent).getTime() : 0;
      const currentTime = c.sent ? new Date(c.sent).getTime() : 0;
      if (currentTime > existingTime) {
        byMedium.set(c.medium, c);
      }
    }
  }

  return (
    <div className="flex gap-1 flex-wrap">
      {Array.from(byMedium.entries()).map(([medium, comm]) => {
        const Icon = mediumIcons[medium] || Bell;
        const label = mediumLabels[medium] || medium;
        const statusColor = commStatusColors[comm.status] || commStatusColors.pending;
        
        return (
          <Tooltip key={comm.id}>
            <TooltipTrigger asChild>
              <Link href={`/comm/${comm.id}`}>
                <Badge 
                  variant="outline" 
                  className={`${statusColor} cursor-pointer gap-1`}
                  data-testid={`badge-comm-${comm.id}`}
                >
                  <Icon className="h-3 w-3" />
                  <span className="text-xs">{comm.status}</span>
                  <ExternalLink className="h-3 w-3" />
                </Badge>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <p>{label}: {comm.status}</p>
              {comm.sent && <p className="text-xs text-muted-foreground">Sent: {format(new Date(comm.sent), "MMM d, h:mm a")}</p>}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function getWorkerName(dispatch: DispatchWithRelations): string {
  if (!dispatch.worker) return 'Unknown Worker';
  const contact = dispatch.worker.contact;
  if (contact) {
    const name = `${contact.given || ''} ${contact.family || ''}`.trim();
    return name || contact.displayName || `Worker #${dispatch.worker.siriusId}`;
  }
  return `Worker #${dispatch.worker.siriusId}`;
}

function JobDispatchesContent() {
  const { job } = useDispatchJobLayout();

  const { data: dispatches, isLoading } = useQuery<DispatchWithRelations[]>({
    queryKey: [`/api/dispatches/job/${job.id}`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Dispatches
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!dispatches || dispatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12" data-testid="empty-state-no-dispatches">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Users className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-empty-title">No Dispatches Yet</h3>
            <p className="text-muted-foreground text-center mb-4" data-testid="text-empty-message">
              No workers have been dispatched to this job yet.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notifications</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispatches.map((dispatch) => (
                <TableRow key={dispatch.id} data-testid={`row-dispatch-${dispatch.id}`}>
                  <TableCell data-testid={`text-worker-${dispatch.id}`}>
                    {dispatch.worker ? (
                      <Link href={`/workers/${dispatch.workerId}`}>
                        <span className="text-foreground hover:underline cursor-pointer" data-testid={`link-worker-${dispatch.id}`}>
                          {getWorkerName(dispatch)}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{getWorkerName(dispatch)}</span>
                    )}
                  </TableCell>
                  <TableCell data-testid={`text-status-${dispatch.id}`}>
                    <Badge className={statusColors[dispatch.status] || statusColors.pending} data-testid={`badge-status-${dispatch.id}`}>
                      {formatStatus(dispatch.status)}
                    </Badge>
                  </TableCell>
                  <TableCell data-testid={`cell-notifications-${dispatch.id}`}>
                    <NotificationCell comms={dispatch.comms} />
                  </TableCell>
                  <TableCell data-testid={`text-start-date-${dispatch.id}`}>
                    {dispatch.startDate
                      ? format(new Date(dispatch.startDate), "MMM d, yyyy")
                      : "-"}
                  </TableCell>
                  <TableCell data-testid={`text-end-date-${dispatch.id}`}>
                    {dispatch.endDate
                      ? format(new Date(dispatch.endDate), "MMM d, yyyy")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {dispatch.workerId && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link href={`/workers/${dispatch.workerId}`}>
                              <Button variant="ghost" size="icon" data-testid={`button-worker-${dispatch.id}`}>
                                <User className="h-4 w-4" />
                              </Button>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>View Worker</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link href={`/dispatch/${dispatch.id}`}>
                            <Button variant="ghost" size="icon" data-testid={`button-view-${dispatch.id}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent>View Dispatch</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function JobDispatchesPage() {
  return (
    <DispatchJobLayout activeTab="dispatches-list">
      <JobDispatchesContent />
    </DispatchJobLayout>
  );
}
