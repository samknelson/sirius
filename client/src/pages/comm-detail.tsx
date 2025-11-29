import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  MessageSquare,
  FileText,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  Send,
  Inbox,
  Phone,
  Mail,
} from "lucide-react";
import { format } from "date-fns";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";

interface CommSmsDetails {
  id: string;
  commId: string;
  to: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
}

interface CommEmailDetails {
  id: string;
  commId: string;
  to: string | null;
  toName: string | null;
  from: string | null;
  fromName: string | null;
  replyTo: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  data: Record<string, unknown> | null;
}

interface CommWithDetails {
  id: string;
  medium: string;
  contactId: string;
  status: string;
  sent: string | null;
  received: string | null;
  data: Record<string, unknown> | null;
  smsDetails?: CommSmsDetails | null;
  emailDetails?: CommEmailDetails | null;
}

interface WinstonLog {
  id: number;
  level: string | null;
  message: string | null;
  timestamp: string | null;
  source: string | null;
  meta: Record<string, unknown> | null;
  module: string | null;
  operation: string | null;
  entityId: string | null;
  description: string | null;
}

export default function CommDetail() {
  const { commId } = useParams<{ commId: string }>();
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [operationFilter, setOperationFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedLog, setSelectedLog] = useState<WinstonLog | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const { data: comm, isLoading: commLoading, error: commError } = useQuery<CommWithDetails>({
    queryKey: ["/api/comm", commId],
    enabled: !!commId,
  });

  const params = new URLSearchParams();
  if (moduleFilter) params.append("module", moduleFilter);
  if (operationFilter) params.append("operation", operationFilter);
  if (startDate) params.append("startDate", startDate);
  if (endDate) params.append("endDate", endDate);

  const { data: logs = [], isLoading: logsLoading } = useQuery<WinstonLog[]>({
    queryKey: ["/api/comm", commId, "logs", moduleFilter, operationFilter, startDate, endDate],
    queryFn: async () => {
      const queryString = params.toString();
      const url = `/api/comm/${commId}/logs${queryString ? `?${queryString}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch logs");
      }
      return response.json();
    },
    enabled: !!commId,
  });

  const uniqueModules = Array.from(new Set(logs.map(log => log.module).filter(Boolean)));
  const uniqueOperations = Array.from(new Set(logs.map(log => log.operation).filter(Boolean)));

  const handleShowDetails = (log: WinstonLog) => {
    setSelectedLog(log);
    setIsDetailsOpen(true);
  };

  const handleClearFilters = () => {
    setModuleFilter("");
    setOperationFilter("");
    setStartDate("");
    setEndDate("");
  };

  const getLevelColor = (level: string | null) => {
    if (!level) return "default";
    const lowerLevel = level.toLowerCase();
    if (lowerLevel === "error") return "destructive";
    if (lowerLevel === "warn" || lowerLevel === "warning") return "warning";
    if (lowerLevel === "info") return "default";
    return "secondary";
  };

  const getStatusBadge = (status: string) => {
    const statusLower = status.toLowerCase();
    
    switch (statusLower) {
      case "delivered":
        return (
          <Badge variant="default" className="bg-green-600 dark:bg-green-700" data-testid="badge-status-delivered">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Delivered
          </Badge>
        );
      case "sent":
        return (
          <Badge variant="default" className="bg-blue-600 dark:bg-blue-700" data-testid="badge-status-sent">
            <Send className="w-3 h-3 mr-1" />
            Sent
          </Badge>
        );
      case "queued":
        return (
          <Badge variant="secondary" data-testid="badge-status-queued">
            <Clock className="w-3 h-3 mr-1" />
            Queued
          </Badge>
        );
      case "sending":
        return (
          <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400" data-testid="badge-status-sending">
            <Clock className="w-3 h-3 mr-1" />
            Sending
          </Badge>
        );
      case "received":
        return (
          <Badge variant="default" data-testid="badge-status-received">
            <Inbox className="w-3 h-3 mr-1" />
            Received
          </Badge>
        );
      case "undelivered":
        return (
          <Badge variant="destructive" className="bg-orange-600 dark:bg-orange-700" data-testid="badge-status-undelivered">
            <AlertCircle className="w-3 h-3 mr-1" />
            Undelivered
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" data-testid="badge-status-failed">
            <AlertCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" data-testid="badge-status-default">
            {status}
          </Badge>
        );
    }
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    return format(new Date(dateStr), "MMM dd, yyyy HH:mm");
  };

  if (commLoading) {
    return (
      <div className="p-6">
        <div className="text-center py-8 text-muted-foreground">Loading communication details...</div>
      </div>
    );
  }

  if (commError || !comm) {
    return (
      <div className="p-6">
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
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Communication Details</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Message Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label className="text-muted-foreground">Medium</Label>
              <div className="flex items-center gap-2 mt-1">
                {comm.medium === "sms" && <Phone className="w-4 h-4" />}
                {comm.medium === "email" && <Mail className="w-4 h-4" />}
                <span className="capitalize font-medium" data-testid="text-comm-medium">{comm.medium}</span>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Status</Label>
              <div className="mt-1" data-testid="text-comm-status">
                {getStatusBadge(comm.status)}
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Sent</Label>
              <div className="font-mono text-sm mt-1" data-testid="text-comm-sent">
                {formatDate(comm.sent)}
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">To</Label>
              <div className="font-mono text-sm mt-1" data-testid="text-comm-to">
                {comm.medium === 'sms' && comm.smsDetails?.to 
                  ? formatPhoneNumberForDisplay(comm.smsDetails.to)
                  : comm.medium === 'email' && comm.emailDetails?.to
                    ? comm.emailDetails.to
                    : "-"}
              </div>
            </div>
          </div>

          {comm.smsDetails?.body && (
            <div>
              <Label className="text-muted-foreground">Message Body</Label>
              <div 
                className="mt-2 p-4 bg-muted rounded-md whitespace-pre-wrap text-sm"
                data-testid="text-comm-body"
              >
                {comm.smsDetails.body}
              </div>
            </div>
          )}

          {comm.emailDetails?.subject && (
            <div>
              <Label className="text-muted-foreground">Subject</Label>
              <div 
                className="mt-2 p-4 bg-muted rounded-md text-sm"
                data-testid="text-comm-subject"
              >
                {comm.emailDetails.subject}
              </div>
            </div>
          )}

          {comm.emailDetails?.bodyText && (
            <div>
              <Label className="text-muted-foreground">Email Body</Label>
              <div 
                className="mt-2 p-4 bg-muted rounded-md whitespace-pre-wrap text-sm"
                data-testid="text-comm-email-body"
              >
                {comm.emailDetails.bodyText}
              </div>
            </div>
          )}

          {comm.smsDetails?.data && Object.keys(comm.smsDetails.data).length > 0 && (
            <div>
              <Label className="text-muted-foreground">SMS Data</Label>
              <pre 
                className="mt-2 p-4 bg-muted rounded-md text-xs overflow-x-auto"
                data-testid="text-comm-sms-data"
              >
                {JSON.stringify(comm.smsDetails.data, null, 2)}
              </pre>
            </div>
          )}

          {comm.emailDetails?.data && Object.keys(comm.emailDetails.data).length > 0 && (
            <div>
              <Label className="text-muted-foreground">Email Data</Label>
              <pre 
                className="mt-2 p-4 bg-muted rounded-md text-xs overflow-x-auto"
                data-testid="text-comm-email-data"
              >
                {JSON.stringify(comm.emailDetails.data, null, 2)}
              </pre>
            </div>
          )}

          {comm.data && Object.keys(comm.data).length > 0 && (
            <div>
              <Label className="text-muted-foreground">Communication Data</Label>
              <pre 
                className="mt-2 p-4 bg-muted rounded-md text-xs overflow-x-auto"
                data-testid="text-comm-data"
              >
                {JSON.stringify(comm.data, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Activity Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="module-filter">Module</Label>
              <Input
                id="module-filter"
                placeholder="Filter by module"
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                list="modules-list"
                data-testid="input-module-filter"
              />
              <datalist id="modules-list">
                {uniqueModules.map((module) => (
                  <option key={module} value={module || ""} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="operation-filter">Operation</Label>
              <Input
                id="operation-filter"
                placeholder="Filter by operation"
                value={operationFilter}
                onChange={(e) => setOperationFilter(e.target.value)}
                list="operations-list"
                data-testid="input-operation-filter"
              />
              <datalist id="operations-list">
                {uniqueOperations.map((operation) => (
                  <option key={operation} value={operation || ""} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            <div>
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-end-date"
              />
            </div>
          </div>

          {(moduleFilter || operationFilter || startDate || endDate) && (
            <div className="mb-4 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                data-testid="button-clear-filters"
              >
                <Filter className="w-4 h-4 mr-2" />
                Clear Filters
              </Button>
            </div>
          )}

          {logsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No log entries found for this communication.
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                      <TableCell className="font-mono text-sm">
                        {log.timestamp ? format(new Date(log.timestamp), "MMM dd, yyyy HH:mm:ss") : "N/A"}
                      </TableCell>
                      <TableCell>
                        {log.level && (
                          <Badge variant={getLevelColor(log.level) as "default" | "secondary" | "destructive"}>
                            {log.level.toUpperCase()}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{log.module || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{log.operation || "—"}</TableCell>
                      <TableCell className="max-w-md truncate">{log.description || log.message || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleShowDetails(log)}
                          data-testid={`button-details-${log.id}`}
                        >
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log Entry Details</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">ID</Label>
                  <div className="font-mono" data-testid="text-log-id">{selectedLog.id}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Level</Label>
                  <div>
                    {selectedLog.level && (
                      <Badge variant={getLevelColor(selectedLog.level) as "default" | "secondary" | "destructive"} data-testid="badge-log-level">
                        {selectedLog.level.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Timestamp</Label>
                  <div className="font-mono" data-testid="text-log-timestamp">
                    {selectedLog.timestamp ? format(new Date(selectedLog.timestamp), "PPpp") : "N/A"}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Source</Label>
                  <div data-testid="text-log-source">{selectedLog.source || "—"}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Module</Label>
                  <div className="font-medium" data-testid="text-log-module">{selectedLog.module || "—"}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Operation</Label>
                  <div data-testid="text-log-operation">{selectedLog.operation || "—"}</div>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Entity ID</Label>
                  <div className="font-mono text-sm" data-testid="text-log-entity-id">{selectedLog.entityId || "—"}</div>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Message</Label>
                <div className="mt-1 p-3 bg-muted rounded-md text-sm" data-testid="text-log-message">
                  {selectedLog.message || "—"}
                </div>
              </div>

              {selectedLog.description && (
                <div>
                  <Label className="text-muted-foreground">Description</Label>
                  <div className="mt-1 p-3 bg-muted rounded-md text-sm" data-testid="text-log-description">
                    {selectedLog.description}
                  </div>
                </div>
              )}

              {selectedLog.meta && (
                <div>
                  <Label className="text-muted-foreground">Metadata</Label>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-x-auto" data-testid="text-log-meta">
                    {JSON.stringify(selectedLog.meta, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
