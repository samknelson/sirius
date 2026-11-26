import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useState } from "react";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, AlertCircle, RefreshCw, Eye, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ComponentSlot } from "@/lib/component-contributions";
import { ELIGIBLE_WORKER_ACTIONS_SLOT, type EligibleWorkerActionsProps } from "@/lib/eligible-worker-actions";
import { getApiErrorMessage } from "@/lib/queryClient";
import { useTerm } from "@/contexts/TerminologyContext";

interface EligibleWorker {
  id: string;
  siriusId: number;
  displayName: string;
  seniorityDate: string | null;
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

const PAGE_SIZE_OPTIONS = [25, 50, 100];

function EligibleWorkersContent() {
  const term = useTerm();
  const { id } = useParams<{ id: string }>();
  const { job } = useDispatchJobLayout();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [siriusIdFilter, setSiriusIdFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");

  const offset = (page - 1) * pageSize;

  const buildFilterParams = () => {
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));
    if (siriusIdFilter.trim()) {
      params.set("siriusId", siriusIdFilter.trim());
    }
    if (nameFilter.trim()) {
      params.set("name", nameFilter.trim());
    }
    return params.toString();
  };

  const handleFilterChange = () => {
    setPage(1);
  };

  const clearFilters = () => {
    setSiriusIdFilter("");
    setNameFilter("");
    setPage(1);
  };

  const hasFilters = siriusIdFilter.trim() || nameFilter.trim();

  const { 
    data, 
    isLoading, 
    isError, 
    error,
    refetch,
    isFetching 
  } = useQuery<EligibleWorkersResponse>({
    queryKey: ["/api/dispatch-jobs", id, "eligible-workers", page, pageSize, siriusIdFilter, nameFilter],
    queryFn: async () => {
      const response = await fetch(`/api/dispatch-jobs/${id}/eligible-workers?${buildFilterParams()}&_t=${Date.now()}`);
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
              {getApiErrorMessage(error, "An error occurred while loading eligible workers.")}
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
          <ComponentSlot<EligibleWorkerActionsProps> name={ELIGIBLE_WORKER_ACTIONS_SLOT} props={{ jobId: id, query: buildFilterParams() }} />
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
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Filter by ID"
              value={siriusIdFilter}
              onChange={(e) => {
                setSiriusIdFilter(e.target.value);
                handleFilterChange();
              }}
              className="w-28"
              data-testid="input-filter-sirius-id"
            />
          </div>
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by name"
                value={nameFilter}
                onChange={(e) => {
                  setNameFilter(e.target.value);
                  handleFilterChange();
                }}
                className="pl-9"
                data-testid="input-filter-name"
              />
            </div>
          </div>
          {hasFilters && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearFilters}
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {workers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Users className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {hasFilters ? "No Matching Workers" : "No Eligible Workers"}
            </h3>
            <p className="text-muted-foreground max-w-md">
              {hasFilters 
                ? "No workers match the current filters. Try adjusting your search criteria."
                : `No workers currently meet the eligibility criteria for this job.${job.jobType ? ` Check the eligibility settings for "${job.jobType.name}" job type.` : " This job has no job type configured with eligibility rules."}`
              }
            </p>
            {hasFilters && (
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters} data-testid="button-clear-filters-empty">
                Clear Filters
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead className="w-32">ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-40">{term("seniorityDate")}</TableHead>
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
                  <TableCell className="text-muted-foreground" data-testid={`text-worker-seniority-${worker.id}`}>
                    {worker.seniorityDate ? new Date(worker.seniorityDate).toLocaleString() : "\u2014"}
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

    </>
  );
}

export default function DispatchJobEligibleWorkersPage() {
  return (
    <DispatchJobLayout activeTab="eligible-workers-list">
      <EligibleWorkersContent />
    </DispatchJobLayout>
  );
}
