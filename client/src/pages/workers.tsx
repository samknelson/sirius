import { useState, useCallback, useMemo, useEffect } from "react";
import { Users } from "lucide-react";
import { WorkersTable, WorkerFilters } from "@/components/workers/workers-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { ListBulkAction } from "@/components/bulk/list-bulk-action";
import { apiRequest, serializeQueryKey, getApiErrorMessage } from "@/lib/queryClient";
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
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  // Pending (typed/selected but not yet applied) search + filter state. Nothing
  // re-queries the server until the user presses the single "Apply" button
  // (mirrors the BTU deployment's apply-button filter model).
  const [nameIdInput, setNameIdInput] = useState("");
  const [contactInput, setContactInput] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<"lastName" | "firstName" | "employer">("lastName");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const defaultFilters: WorkerFilters = {
    employerId: "all",
    employerTypeId: "all",
    bargainingUnitId: "all",
    benefitId: "all",
    contactStatus: "all",
    jobTitle: "",
    memberStatusId: "all",
  };
  const [filters, setFilters] = useState<WorkerFilters>(defaultFilters);
  // Applied state — the only inputs the server query sees.
  const [appliedNameId, setAppliedNameId] = useState("");
  const [appliedContact, setAppliedContact] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<WorkerFilters>(defaultFilters);

  const handleApplySearch = useCallback(() => {
    setAppliedNameId(nameIdInput);
    setAppliedContact(contactInput);
    setAppliedFilters(filters);
    setPage(1);
  }, [nameIdInput, contactInput, filters]);

  // Filter controls just accumulate locally; applying happens via the button.
  const handleFiltersChange = useCallback((newFilters: WorkerFilters) => {
    setFilters(newFilters);
  }, []);

  // Build the filter param object exactly the way the paginated query does, so the
  // "all matching IDs" endpoint receives identical inputs and can never drift.
  const filterParams = useMemo(() => ({
    nameIdSearch: appliedNameId,
    contactSearch: appliedContact,
    sortOrder,
    sortBy,
    employerId: appliedFilters.employerId,
    employerTypeId: appliedFilters.employerTypeId,
    bargainingUnitId: appliedFilters.bargainingUnitId,
    benefitId: appliedFilters.benefitId,
    contactStatus: appliedFilters.contactStatus,
    hasMultipleEmployers: appliedFilters.hasMultipleEmployers,
    jobTitle: appliedFilters.jobTitle,
    memberStatusId: appliedFilters.memberStatusId,
    representativeId: appliedFilters.representativeId,
  }), [appliedNameId, appliedContact, sortOrder, sortBy, appliedFilters]);

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
      // Reuse the exact same query-key serialization as the paginated list query
      // so the all-ids request receives identical query parameters.
      const url = serializeQueryKey(["/api/workers/with-details/all-ids", filterParams]);
      const res = await apiRequest("GET", url);
      setSelectedIds(new Set(res.contactIds));
      toast({
        title: "Selected all matching workers",
        description: `${res.total.toLocaleString()} recipient${res.total === 1 ? "" : "s"} selected.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to select all",
        description: getApiErrorMessage(err, "Unknown error"),
        variant: "destructive",
      });
    } finally {
      setIsSelectingAll(false);
    }
  }, [filterParams, toast]);

  const tabs = [
    { id: "list", label: "List", href: "/workers" },
    ...(hasPermission("staff") ? [{ id: "add", label: "Add", href: "/workers/add" }] : []),
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
          nameIdQuery={nameIdInput}
          onNameIdChange={setNameIdInput}
          contactQuery={contactInput}
          onContactChange={setContactInput}
          onApplySearch={handleApplySearch}
          appliedNameId={appliedNameId}
          appliedContact={appliedContact}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          appliedFilters={appliedFilters}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      </main>
    </div>
  );
}
