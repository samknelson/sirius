import { useState, useCallback, useMemo, useEffect } from "react";
import { Users } from "lucide-react";
import { WorkersTable, WorkerFilters } from "@/components/workers/workers-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { ListBulkAction } from "@/components/bulk/list-bulk-action";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PaginatedWorkersResponse {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function Workers() {
  const [location] = useLocation();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedJobTitle, setAppliedJobTitle] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<"lastName" | "firstName" | "employer">("lastName");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const [filters, setFilters] = useState<WorkerFilters>({
    employerId: "all",
    employerTypeId: "all",
    bargainingUnitId: "all",
    benefitId: "all",
    contactStatus: "all",
    jobTitle: "",
    memberStatusId: "all",
  });

  const handleApplySearch = useCallback(() => {
    setAppliedSearch(searchInput);
    setAppliedJobTitle(filters.jobTitle);
    setPage(1);
  }, [searchInput, filters.jobTitle]);

  const handleFiltersChange = useCallback((newFilters: WorkerFilters) => {
    setFilters(prev => {
      const jobTitleOnly = prev.employerId === newFilters.employerId
        && prev.employerTypeId === newFilters.employerTypeId
        && prev.bargainingUnitId === newFilters.bargainingUnitId
        && prev.benefitId === newFilters.benefitId
        && prev.contactStatus === newFilters.contactStatus
        && prev.hasMultipleEmployers === newFilters.hasMultipleEmployers
        && prev.memberStatusId === newFilters.memberStatusId
        && prev.representativeId === newFilters.representativeId
        && prev.jobTitle !== newFilters.jobTitle;
      if (!jobTitleOnly) {
        setPage(1);
      }
      return newFilters;
    });
  }, []);

  // Build the filter param object exactly the way the paginated query does, so the
  // "all matching IDs" endpoint receives identical inputs and can never drift.
  const filterParams = useMemo(() => ({
    search: appliedSearch,
    sortOrder,
    sortBy,
    employerId: filters.employerId,
    employerTypeId: filters.employerTypeId,
    bargainingUnitId: filters.bargainingUnitId,
    benefitId: filters.benefitId,
    contactStatus: filters.contactStatus,
    hasMultipleEmployers: filters.hasMultipleEmployers,
    jobTitle: appliedJobTitle,
    memberStatusId: filters.memberStatusId,
    representativeId: filters.representativeId,
  }), [appliedSearch, sortOrder, sortBy, filters, appliedJobTitle]);

  // Reset selection whenever the effective filter set changes so users can never
  // accidentally bulk-message recipients that no longer match their current filters.
  const filterSignature = useMemo(() => JSON.stringify(filterParams), [filterParams]);
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterSignature]);

  const { data: paginatedData, isLoading } = useQuery<PaginatedWorkersResponse>({
    queryKey: ["/api/workers/with-details/paginated", { page, pageSize, ...filterParams }],
  });

  const workers = paginatedData?.data ?? [];
  const total = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

  const visibleSelectedCount = useMemo(
    () => workers.filter(w => selectedIds.has(w.contact_id)).length,
    [workers, selectedIds],
  );

  const handleSelectAllMatching = useCallback(async () => {
    setIsSelectingAll(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filterParams).forEach(([k, v]) => {
        if (v === undefined || v === null || v === "" || v === false) return;
        params.set(k, String(v));
      });
      const res = await apiRequest("GET", `/api/workers/with-details/all-ids?${params.toString()}`);
      setSelectedIds(new Set(res.contactIds));
      toast({
        title: "Selected all matching workers",
        description: `${res.total.toLocaleString()} recipient${res.total === 1 ? "" : "s"} selected.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to select all",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSelectingAll(false);
    }
  }, [filterParams, toast]);

  const tabs = [
    { id: "list", label: "List", href: "/workers" },
    { id: "add", label: "Add", href: "/workers/add" },
  ];

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Workers" 
        icon={<Users className="text-primary-foreground" size={16} />}
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground" data-testid="text-worker-count">
              {total.toLocaleString()} Workers
            </span>
            <ListBulkAction
              selectedContactIds={Array.from(selectedIds)}
              totalMatching={total}
              visibleSelectedCount={visibleSelectedCount}
              onSelectAllMatching={handleSelectAllMatching}
              isSelectingAllMatching={isSelectingAll}
              sourceLabel="Workers"
              testIdPrefix="workers-bulk-action"
            />
          </div>
        }
      />

      {/* Tab Navigation */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant={location === tab.href ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-workers-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <WorkersTable 
          workers={workers} 
          isLoading={isLoading}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
          searchQuery={searchInput}
          onSearchChange={setSearchInput}
          onApplySearch={handleApplySearch}
          appliedSearch={appliedSearch}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          appliedJobTitle={appliedJobTitle}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      </main>
    </div>
  );
}
