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
import { ComponentConfig } from "@shared/components";
import {
  normalizeWorkerBenefitRoleFilters,
  type WorkerBenefitRoleFilters,
} from "@shared/worker-benefit-role-filters";

interface PaginatedWorkersResponse {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const BENEFIT_ROLE_FILTER_KEYS = [
  "isSubscriber",
  "isDependent",
  "subscriberSinceFrom",
  "subscriberSinceThrough",
  "dependentSinceFrom",
  "dependentSinceThrough",
] as const;

function withoutWorkerBenefitRoleFilters(filters: WorkerFilters): WorkerFilters {
  const next = { ...filters };
  for (const key of BENEFIT_ROLE_FILTER_KEYS) {
    delete next[key];
  }
  return next;
}

export default function Workers() {
  const [location] = useLocation();
  const { hasPermission } = useAuth();
  const canSearchSsn = hasPermission("workers.ssn");
  const { toast } = useToast();
  const { data: componentConfigs = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
  });
  const trustBenefitsEnabled =
    componentConfigs.find((config) => config.componentId === "trust.benefits")?.enabled ?? false;
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  // Pending (typed/selected but not yet applied) search + filter state. Nothing
  // re-queries the server until the user presses the single "Apply" button
  // (mirrors the BTU deployment's apply-button filter model).
  const [nameIdInput, setNameIdInput] = useState("");
  const [contactInput, setContactInput] = useState("");
  const [ssnInput, setSsnInput] = useState("");
  const [appliedSsn, setAppliedSsn] = useState("");
  // The query cache key contains only a generation, never the SSN.
  const [ssnGeneration, setSsnGeneration] = useState(0);
  const [listSession] = useState(() => crypto.randomUUID());
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
    if (canSearchSsn && ssnInput.trim()) {
      const digits = ssnInput.replace(/\D/g, "");
      if (!/^[\d\s-]+$/.test(ssnInput) || (digits.length !== 9 && digits.length !== 4)) {
        toast({ title: "Invalid SSN", description: "Enter a full SSN or exactly the last four digits.", variant: "destructive" });
        return;
      }
    }
    let normalizedRoleFilters: WorkerBenefitRoleFilters;
    try {
      normalizedRoleFilters = normalizeWorkerBenefitRoleFilters(filters, trustBenefitsEnabled);
    } catch (error) {
      toast({
        title: "Invalid benefit role filters",
        description: error instanceof Error
          ? error.message
          : "Enter valid benefit role filter values and month ranges.",
        variant: "destructive",
      });
      return;
    }

    setAppliedNameId(nameIdInput);
    setAppliedContact(contactInput);
    setAppliedSsn(canSearchSsn ? ssnInput.trim() : "");
    setSsnGeneration(value => value + 1);
    // Applied state is canonicalized so requests and exports can never include
    // the pending-only `any` or blank values.
    setAppliedFilters({
      ...withoutWorkerBenefitRoleFilters(filters),
      ...normalizedRoleFilters,
    });
    setPage(1);
    // Applying is an explicit recipient-set boundary, even when the effective
    // filter values happen to be unchanged.
    setSelectedIds(new Set());
  }, [nameIdInput, contactInput, ssnInput, filters, toast, trustBenefitsEnabled, canSearchSsn]);

  useEffect(() => {
    if (!canSearchSsn) {
      setSsnInput("");
      setAppliedSsn("");
      setSsnGeneration(value => value + 1);
    }
  }, [canSearchSsn]);

  // Filter controls just accumulate locally; applying happens via the button.
  const handleFiltersChange = useCallback((newFilters: WorkerFilters) => {
    setFilters(newFilters);
  }, []);

  // A trust.benefits deployment may be turned off while this page is open.
  // Clear both generations of local state immediately; filterParams below also
  // gates the request during the transition before this effect runs.
  useEffect(() => {
    if (!trustBenefitsEnabled) {
      setFilters((current) => withoutWorkerBenefitRoleFilters(current));
      setAppliedFilters((current) => withoutWorkerBenefitRoleFilters(current));
      setPage(1);
      setSelectedIds(new Set());
    }
  }, [trustBenefitsEnabled]);

  const appliedBenefitRoleFilters = useMemo(
    () => normalizeWorkerBenefitRoleFilters(appliedFilters, trustBenefitsEnabled),
    [appliedFilters, trustBenefitsEnabled],
  );

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
    ...appliedBenefitRoleFilters,
  }), [
    appliedNameId,
    appliedContact,
    sortOrder,
    sortBy,
    appliedFilters,
    appliedBenefitRoleFilters,
  ]);

  // Reset selection whenever the effective filter set changes so users can never
  // accidentally bulk-message recipients that no longer match their current filters.
  const filterSignature = useMemo(() => JSON.stringify(filterParams), [filterParams]);
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterSignature]);

  const { data: paginatedData, isLoading } = useQuery<PaginatedWorkersResponse>({
    queryKey: ["workers-list", listSession, { page, pageSize, ...filterParams }, ssnGeneration],
    queryFn: () => appliedSsn && canSearchSsn
      ? apiRequest("POST", "/api/workers/with-details/paginated", { page, pageSize, ...filterParams, ssn: appliedSsn })
      : apiRequest("GET", serializeQueryKey(["/api/workers/with-details/paginated", { page, pageSize, ...filterParams }])),
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
      const res = appliedSsn && canSearchSsn
        ? await apiRequest("POST", "/api/workers/with-details/all-ids", { ...filterParams, ssn: appliedSsn })
        : await apiRequest("GET", serializeQueryKey(["/api/workers/with-details/all-ids", filterParams]));
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
  }, [filterParams, appliedSsn, canSearchSsn, toast]);

  const handleSecureExport = useCallback(async (filters: Record<string, string>) => {
    try {
      const response = await fetch("/api/workers/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...filters, ssn: appliedSsn }),
      });
      if (!response.ok) throw new Error("Failed to export workers");
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `workers_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch {
      toast({ title: "Failed to export workers", variant: "destructive" });
    }
  }, [appliedSsn, toast]);

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
          ssnQuery={canSearchSsn ? ssnInput : undefined}
          onSsnChange={setSsnInput}
          onSecureExport={appliedSsn && canSearchSsn ? handleSecureExport : undefined}
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
           enableBenefitRoleFilters={trustBenefitsEnabled}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      </main>
    </div>
  );
}
