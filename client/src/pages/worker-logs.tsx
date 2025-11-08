import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Calendar, Filter } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

interface WinstonLog {
  id: number;
  level: string | null;
  message: string | null;
  timestamp: string | null;
  source: string | null;
  meta: any;
  module: string | null;
  operation: string | null;
  entityId: string | null;
  description: string | null;
}

function WorkerLogsContent() {
  const { worker } = useWorkerLayout();
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [operationFilter, setOperationFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedLog, setSelectedLog] = useState<WinstonLog | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Build query params
  const params = new URLSearchParams();
  if (moduleFilter) params.append("module", moduleFilter);
  if (operationFilter) params.append("operation", operationFilter);
  if (startDate) params.append("startDate", startDate);
  if (endDate) params.append("endDate", endDate);

  // Fetch worker logs
  const { data: logs = [], isLoading } = useQuery<WinstonLog[]>({
    queryKey: ["/api/workers", worker.id, "logs", moduleFilter, operationFilter, startDate, endDate],
    queryFn: async () => {
      const queryString = params.toString();
      const url = `/api/workers/${worker.id}/logs${queryString ? `?${queryString}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch worker logs");
      }
      return response.json();
    },
  });

  // Get unique modules and operations for filter suggestions
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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Activity Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters */}
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

          {/* Logs Table */}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No log entries found for this worker.
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
                          <Badge variant={getLevelColor(log.level) as any}>
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

      {/* Log Details Modal */}
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
                      <Badge variant={getLevelColor(selectedLog.level) as any} data-testid="badge-log-level">
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
    </>
  );
}

export default function WorkerLogs() {
  return (
    <WorkerLayout activeTab="logs">
      <WorkerLogsContent />
    </WorkerLayout>
  );
}
