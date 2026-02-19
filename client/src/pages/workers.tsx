import { useState, useCallback } from "react";
import { Users } from "lucide-react";
import { WorkersTable, WorkerFilters } from "@/components/workers/workers-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";

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
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<"lastName" | "firstName" | "employer">("lastName");
  const [filters, setFilters] = useState<WorkerFilters>({
    employerId: "all",
    employerTypeId: "all",
    bargainingUnitId: "all",
    benefitId: "all",
    contactStatus: "all",
  });

  const handleApplySearch = useCallback(() => {
    setAppliedSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleFiltersChange = useCallback((newFilters: WorkerFilters) => {
    setFilters(newFilters);
    setPage(1);
  }, []);

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
    }],
  });

  const workers = paginatedData?.data ?? [];
  const total = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

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
          <span className="text-sm text-muted-foreground" data-testid="text-worker-count">
            {total.toLocaleString()} Workers
          </span>
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
        />
      </main>
    </div>
  );
}
