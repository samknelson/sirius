import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useState } from "react";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Users, AlertCircle, RefreshCw, Code, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { prettifySqlSimple } from "@shared/utils/sql-prettify";

interface EligibleWorker {
  id: string;
  siriusId: number;
  displayName: string;
}

interface EligibleWorkersResponse {
  workers: EligibleWorker[];
  total: number;
  appliedConditions: Array<{
    pluginId: string;
    condition: {
      type: string;
      category: string;
      value: string;
    };
  }>;
}

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

interface SqlResponse {
  sql: string;
  params: unknown[];
  appliedConditions: Array<{
    pluginId: string;
    condition: {
      type: string;
      category: string;
      value: string;
    };
  }>;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

function EligibleWorkersContent() {
  const { id } = useParams<{ id: string }>();
  const { job } = useDispatchJobLayout();
  const { toast } = useToast();
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [sqlData, setSqlData] = useState<SqlResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const offset = (page - 1) * pageSize;

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const isDebugEnabled = componentConfig.find(c => c.componentId === "debug")?.enabled ?? false;

  const fetchSqlMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/dispatch-jobs/${id}/eligible-workers-sql?limit=${pageSize}&offset=${offset}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to fetch SQL");
      }
      return response.json() as Promise<SqlResponse>;
    },
    onSuccess: (data) => {
      setSqlData(data);
      setShowSqlModal(true);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fetch SQL query",
        variant: "destructive",
      });
    },
  });

  const handleShowSql = () => {
    fetchSqlMutation.mutate();
  };

  const { 
    data, 
    isLoading, 
    isError, 
    error,
    refetch,
    isFetching 
  } = useQuery<EligibleWorkersResponse>({
    queryKey: ["/api/dispatch-jobs", id, "eligible-workers", page, pageSize],
    queryFn: async () => {
      const response = await fetch(`/api/dispatch-jobs/${id}/eligible-workers?limit=${pageSize}&offset=${offset}&_t=${Date.now()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch eligible workers");
      }
      return response.json();
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const handlePageSizeChange = (newSize: string) => {
    setPageSize(Number(newSize));
    setPage(1);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Eligible Workers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Eligible Workers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="text-destructive" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              Failed to Load Workers
            </h3>
            <p className="text-muted-foreground max-w-md mb-4">
              {error instanceof Error ? error.message : "An error occurred while loading eligible workers."}
            </p>
            <Button onClick={() => refetch()} data-testid="button-retry">
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const workers = data?.workers || [];

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Eligible Workers
          <span className="text-muted-foreground font-normal text-base">
            ({total})
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          {isDebugEnabled && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleShowSql} 
              disabled={fetchSqlMutation.isPending}
              data-testid="button-debug-sql"
            >
              <Code className="h-4 w-4 mr-1" />
              Debug: show SQL
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => refetch()} 
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {workers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Users className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              No Eligible Workers
            </h3>
            <p className="text-muted-foreground max-w-md">
              No workers currently meet the eligibility criteria for this job.
              {job.jobType ? ` Check the eligibility settings for "${job.jobType.name}" job type.` : " This job has no job type configured with eligibility rules."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead className="w-32">ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-24 text-right">View</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((worker, index) => (
                <TableRow key={worker.id} data-testid={`row-worker-${worker.id}`}>
                  <TableCell className="text-muted-foreground" data-testid={`text-row-number-${worker.id}`}>
                    {offset + index + 1}
                  </TableCell>
                  <TableCell data-testid={`text-worker-sirius-id-${worker.id}`}>
                    {worker.siriusId}
                  </TableCell>
                  <TableCell className="font-medium" data-testid={`text-worker-name-${worker.id}`}>
                    {worker.displayName || "Unnamed Worker"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/workers/${worker.id}`}>
                      <Button variant="ghost" size="icon" data-testid={`button-view-worker-${worker.id}`}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        
        {total > 0 && (
          <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page:</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="w-20" data-testid="select-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground" data-testid="text-pagination-info">
                {offset + 1}-{Math.min(offset + pageSize, total)} of {total}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || isFetching}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isFetching}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {data?.appliedConditions && data.appliedConditions.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Eligibility based on: {data.appliedConditions.map(c => c.condition.category).join(", ")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog open={showSqlModal} onOpenChange={setShowSqlModal}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Eligible Workers SQL Query
          </DialogTitle>
          <DialogDescription>
            The SQL query used to fetch eligible workers for this job.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[60vh]">
          {sqlData && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">SQL:</h4>
                <pre className="p-4 bg-muted rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
                  {prettifySqlSimple(sqlData.sql)}
                </pre>
              </div>
              {sqlData.params.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Parameters:</h4>
                  <pre className="p-4 bg-muted rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
                    {JSON.stringify(sqlData.params, null, 2)}
                  </pre>
                </div>
              )}
              {sqlData.appliedConditions.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Applied Conditions:</h4>
                  <pre className="p-4 bg-muted rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
                    {JSON.stringify(sqlData.appliedConditions, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
    </>
  );
}

export default function DispatchJobEligibleWorkersPage() {
  return (
    <DispatchJobLayout activeTab="eligible-workers">
      <EligibleWorkersContent />
    </DispatchJobLayout>
  );
}
