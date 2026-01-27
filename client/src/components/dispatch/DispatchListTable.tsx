import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Eye, User, Briefcase, Mail, MessageSquare, Bell, ExternalLink, Filter } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DispatchWithRelations, CommSummary } from "../../../../server/storage/dispatches";

const statusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  notified: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  accepted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  layoff: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  resigned: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  declined: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

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
  "in-app": Bell,
  in_app: Bell,
};

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  inapp: "In-App",
  "in-app": "In-App",
  in_app: "In-App",
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

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

function getJobTitle(dispatch: DispatchWithRelations): string {
  return dispatch.job?.title || 'Unknown Job';
}

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "notified", label: "Notified" },
  { value: "accepted", label: "Accepted" },
  { value: "layoff", label: "Layoff" },
  { value: "resigned", label: "Resigned" },
  { value: "declined", label: "Declined" },
];

export interface DispatchListTableProps {
  dispatches: DispatchWithRelations[];
  showWorker?: boolean;
  showJob?: boolean;
}

export function DispatchListTable({ 
  dispatches, 
  showWorker = false,
  showJob = false,
}: DispatchListTableProps) {
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredDispatches = useMemo(() => {
    if (statusFilter === "all") return dispatches;
    return dispatches.filter(d => d.status === statusFilter);
  }, [dispatches, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} data-testid={`option-status-${option.value}`}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {statusFilter !== "all" && (
          <span className="text-sm text-muted-foreground">
            {filteredDispatches.length} of {dispatches.length}
          </span>
        )}
      </div>
      <Table>
      <TableHeader>
        <TableRow>
          {showWorker && <TableHead>Worker</TableHead>}
          {showJob && <TableHead>Job</TableHead>}
          <TableHead>Status</TableHead>
          <TableHead>Notifications</TableHead>
          <TableHead>Start Date</TableHead>
          <TableHead>End Date</TableHead>
          <TableHead className="w-24">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredDispatches.map((dispatch) => (
          <TableRow key={dispatch.id} data-testid={`row-dispatch-${dispatch.id}`}>
            {showWorker && (
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
            )}
            {showJob && (
              <TableCell data-testid={`text-job-${dispatch.id}`}>
                <div className="flex flex-col">
                  <Link href={`/dispatch/job/${dispatch.jobId}`}>
                    <span className="text-foreground hover:underline cursor-pointer" data-testid={`link-job-${dispatch.id}`}>
                      {getJobTitle(dispatch)}
                    </span>
                  </Link>
                  {dispatch.job?.employer && (
                    <Link href={`/employers/${dispatch.job.employer.id}`}>
                      <span className="text-muted-foreground text-sm hover:underline cursor-pointer" data-testid={`link-employer-${dispatch.id}`}>
                        {dispatch.job.employer.name}
                      </span>
                    </Link>
                  )}
                </div>
              </TableCell>
            )}
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
                {showWorker && dispatch.workerId && (
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
                {showJob && dispatch.jobId && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link href={`/dispatch/job/${dispatch.jobId}`}>
                        <Button variant="ghost" size="icon" data-testid={`button-job-${dispatch.id}`}>
                          <Briefcase className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>View Job</TooltipContent>
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
    </div>
  );
}
