import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, ChevronLeft, ChevronRight, Eye } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

interface LogEntry {
  id: number;
  level: string;
  message: string;
  module: string | null;
  operation: string | null;
  entityId: string | null;
  description: string | null;
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  timestamp: string;
  meta: any;
}

interface LogsResponse {
  logs: LogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface FiltersResponse {
  modules: string[];
  operations: string[];
}

export default function LogsPage() {
  usePageTitle("System Logs");
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [operationFilter, setOperationFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  // Fetch logs
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    ...(moduleFilter && { module: moduleFilter }),
    ...(operationFilter && { operation: operationFilter }),
    ...(searchQuery && { search: searchQuery }),
  });
  
  const { data: logsData, isLoading } = useQuery<LogsResponse>({
    queryKey: [`/api/logs?${queryParams.toString()}`],
  });

  // Fetch filter options
  const { data: filtersData } = useQuery<FiltersResponse>({
    queryKey: ["/api/logs/filters"],
  });

  const handleSearch = () => {
    setSearchQuery(searchInput);
    setPage(1);
  };

  const handleClearFilters = () => {
    setModuleFilter("");
    setOperationFilter("");
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  };

  const getLevelColor = (level: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (level.toLowerCase()) {
      case "error":
        return "destructive";
      case "warn":
        return "destructive";
      case "info":
        return "default";
      case "debug":
        return "secondary";
      default:
        return "outline";
    }
  };

  if (isLoading && !logsData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  const logs = logsData?.logs || [];
  const pagination = logsData?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 };

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle data-testid="title-page">System Logs</CardTitle>
          <CardDescription>
            View and search system activity logs and audit trail
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="text-sm font-medium mb-2 block">Module</label>
              <Select
                value={moduleFilter}
                onValueChange={(value) => {
                  setModuleFilter(value === "all" ? "" : value);
                  setPage(1);
                }}
              >
                <SelectTrigger data-testid="select-module-filter">
                  <SelectValue placeholder="All modules" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All modules</SelectItem>
                  {filtersData?.modules.map((module) => (
                    <SelectItem key={module} value={module}>
                      {module}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Operation</label>
              <Select
                value={operationFilter}
                onValueChange={(value) => {
                  setOperationFilter(value === "all" ? "" : value);
                  setPage(1);
                }}
              >
                <SelectTrigger data-testid="select-operation-filter">
                  <SelectValue placeholder="All operations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All operations</SelectItem>
                  {filtersData?.operations.map((operation) => (
                    <SelectItem key={operation} value={operation}>
                      {operation}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium mb-2 block">Search</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Search description, message, or entity ID..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  data-testid="input-search"
                />
                <Button onClick={handleSearch} data-testid="button-search">
                  <Search className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={handleClearFilters}
                  data-testid="button-clear-filters"
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>

          {/* Results count */}
          <div className="mb-4 text-sm text-muted-foreground" data-testid="text-results-count">
            Showing {logs.length} of {pagination.total} logs
          </div>

          {/* Table */}
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Level</TableHead>
                  <TableHead className="w-[120px]">Time</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[120px]">Module</TableHead>
                  <TableHead className="w-[150px]">User</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No logs found
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                      <TableCell>
                        <Badge variant={getLevelColor(log.level)} data-testid={`badge-level-${log.id}`}>
                          {log.level}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-timestamp-${log.id}`}>
                        {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="max-w-md truncate" data-testid={`text-description-${log.id}`}>
                        {log.description || log.message}
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-module-${log.id}`}>
                        {log.module || "-"}
                      </TableCell>
                      <TableCell className="text-sm truncate" data-testid={`text-user-${log.id}`}>
                        {log.userEmail || "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLog(log)}
                          data-testid={`button-view-${log.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  data-testid="button-previous-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= pagination.totalPages}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log Detail Modal */}
      <Dialog open={selectedLog !== null} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-log-detail">
          <DialogHeader>
            <DialogTitle>Log Entry Details</DialogTitle>
            <DialogDescription>
              {selectedLog && formatDistanceToNow(new Date(selectedLog.timestamp), { addSuffix: true })}
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium">Level</p>
                  <Badge variant={getLevelColor(selectedLog.level)}>{selectedLog.level}</Badge>
                </div>
                <div>
                  <p className="text-sm font-medium">Timestamp</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(selectedLog.timestamp).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Module</p>
                  <p className="text-sm text-muted-foreground">{selectedLog.module || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium">Operation</p>
                  <p className="text-sm text-muted-foreground">{selectedLog.operation || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium">User Email</p>
                  <p className="text-sm text-muted-foreground">{selectedLog.userEmail || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium">IP Address</p>
                  <p className="text-sm text-muted-foreground">{selectedLog.ipAddress || "N/A"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm font-medium">Entity ID</p>
                  <p className="text-sm text-muted-foreground">{selectedLog.entityId || "N/A"}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Message</p>
                <div className="bg-muted p-3 rounded-md text-sm">
                  {selectedLog.message}
                </div>
              </div>

              {selectedLog.description && (
                <div>
                  <p className="text-sm font-medium mb-2">Description</p>
                  <div className="bg-muted p-3 rounded-md text-sm">
                    {selectedLog.description}
                  </div>
                </div>
              )}

              {selectedLog.meta && Object.keys(selectedLog.meta).length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Additional Metadata</p>
                  <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
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
