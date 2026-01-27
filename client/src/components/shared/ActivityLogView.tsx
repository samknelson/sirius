import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Filter } from "lucide-react";
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
import { WinstonLog } from "@/lib/system-types";

interface ActivityLogViewProps {
  hostEntityId: string;
  title?: string;
}

export function ActivityLogView({ hostEntityId, title = "Activity Logs" }: ActivityLogViewProps) {
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [operationFilter, setOperationFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedLog, setSelectedLog] = useState<WinstonLog | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const params = new URLSearchParams();
  params.append("hostEntityId", hostEntityId);
  if (moduleFilter) params.append("module", moduleFilter);
  if (operationFilter) params.append("operation", operationFilter);
  if (startDate) params.append("startDate", startDate);
  if (endDate) params.append("endDate", endDate);

  const { data: logs = [], isLoading } = useQuery<WinstonLog[]>({
    queryKey: ["/api/logs/by-entity", hostEntityId, moduleFilter, operationFilter, startDate, endDate],
    queryFn: async () => {
      const url = `/api/logs/by-entity?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch logs");
      }
      return response.json();
    },
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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {title}
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

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No log entries found.
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
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
                      <TableCell className="text-muted-foreground">
                        {log.userEmail || "—"}
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

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log Details</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Timestamp</Label>
                  <p className="font-mono text-sm">
                    {selectedLog.timestamp
                      ? format(new Date(selectedLog.timestamp), "MMM dd, yyyy HH:mm:ss")
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Level</Label>
                  <p>
                    {selectedLog.level && (
                      <Badge variant={getLevelColor(selectedLog.level) as any}>
                        {selectedLog.level.toUpperCase()}
                      </Badge>
                    )}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">User</Label>
                  <p>{selectedLog.userEmail || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">IP Address</Label>
                  <p className="font-mono text-sm">{selectedLog.ipAddress || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Module</Label>
                  <p>{selectedLog.module || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Operation</Label>
                  <p>{selectedLog.operation || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Entity ID</Label>
                  <p className="font-mono text-sm">{selectedLog.entityId || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Source</Label>
                  <p>{selectedLog.source || "—"}</p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p>{selectedLog.description || selectedLog.message || "—"}</p>
              </div>

              {selectedLog.meta && Object.keys(selectedLog.meta).length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Metadata</Label>
                  <pre className="mt-2 p-4 bg-muted rounded-lg overflow-x-auto text-sm">
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
