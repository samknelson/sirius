import { useState, useCallback, useMemo } from "react";
import { Users, Megaphone } from "lucide-react";
import { WorkersTable, WorkerFilters } from "@/components/workers/workers-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { CampaignComposerModal } from "@/components/bulk/CampaignComposerModal";

type PolicyAccessResponse = { access: { granted: boolean } };

interface PaginatedWorkersResponse {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function Workers() {
  const [location] = useLocation();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedJobTitle, setAppliedJobTitle] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<"lastName" | "firstName" | "employer">("lastName");
  const [filters, setFilters] = useState<WorkerFilters>({
    employerId: "all",
    employerTypeId: "all",
    bargainingUnitId: "all",
    benefitId: "all",
    contactStatus: "all",
    jobTitle: "",
    memberStatusId: "all",
  });
  const [composerOpen, setComposerOpen] = useState(false);

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

  const { data: bulkEditPolicy } = useQuery<PolicyAccessResponse>({
    queryKey: ["/api/access/policies/bulk.edit"],
    staleTime: 30000,
  });

  const { data: paginatedData, isLoading } = useQuery<PaginatedWorkersResponse>({
    queryKey: ["/api/workers/with-details/paginated", { 
      page, 
      pageSize, 
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
    }],
  });

  const workers = paginatedData?.data ?? [];
  const total = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

  const audienceFilters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (appliedSearch) f.search = appliedSearch;
    if (filters.employerId !== "all") f.employerId = filters.employerId;
    if (filters.employerTypeId !== "all") f.employerTypeId = filters.employerTypeId;
    if (filters.bargainingUnitId !== "all") f.bargainingUnitId = filters.bargainingUnitId;
    if (filters.benefitId !== "all") f.benefitId = filters.benefitId;
    if (filters.contactStatus !== "all") f.contactStatus = filters.contactStatus;
    if (filters.hasMultipleEmployers) f.hasMultipleEmployers = true;
    if (appliedJobTitle) f.jobTitle = appliedJobTitle;
    if (filters.memberStatusId !== "all") f.memberStatusId = filters.memberStatusId;
    if (filters.representativeId && filters.representativeId !== "all") f.representativeId = filters.representativeId;
    return f;
  }, [appliedSearch, appliedJobTitle, filters]);

  const audienceLabel = useMemo(() => {
    const parts: string[] = [];
    if (appliedSearch) parts.push(`search: "${appliedSearch}"`);
    const activeFilterCount = Object.keys(audienceFilters).filter(k => k !== "search").length;
    if (activeFilterCount > 0) parts.push(`${activeFilterCount} filter${activeFilterCount !== 1 ? "s" : ""} applied`);
    return parts.join(", ") || `${total.toLocaleString()} workers (no filters)`;
  }, [appliedSearch, audienceFilters, total]);

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
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground" data-testid="text-worker-count">
              {total.toLocaleString()} Workers
            </span>
            {bulkEditPolicy?.access?.granted && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setComposerOpen(true)}
                data-testid="button-bulk-message-workers"
              >
                <Megaphone className="h-4 w-4 mr-2" />
                Bulk Message
              </Button>
            )}
          </div>
        }
      />

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
        />
      </main>

      {composerOpen && (
        <CampaignComposerModal
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          audienceType="worker"
          audienceFilters={audienceFilters}
          audienceLabel={audienceLabel}
        />
      )}
    </div>
  );
}
