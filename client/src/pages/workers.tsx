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
import { fetchSecureWorkerExport } from "@/lib/secure-worker-export";
import {
  normalizeEmployerEmploymentFilters,
} from "@shared/utils/employer-employment-filters";
import { normalizeWorkerDirectoryFilters } from "@shared/worker-directory-filters";

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
  const { hasPermission, hasComponent, authReady } = useAuth();
  const canSearchSsn = hasPermission("workers.ssn");
  const { toast } = useToast();
  const { data: componentConfigs = [], isSuccess: componentConfigsLoaded } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
  });
  const trustBenefitsEnabled =
    componentConfigs.find((config) => config.componentId === "trust.benefits")?.enabled ?? false;
  const cardcheckEnabled = hasComponent("cardcheck");
  const bargainingUnitsEnabled = hasComponent("bargainingunits");
  const politicalEnabled = hasComponent("sitespecific.btu.political");
  const stewardEnabled = hasComponent("worker.steward");
  const btuEnabled = hasComponent("sitespecific.btu");
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
    employerIds: [],
    employerTypeId: "all",
    bargainingUnitId: "all",
    bargainingUnitIds: [],
    benefitId: "all",
    benefitIds: [],
    contactStatus: "all",
    jobTitle: "",
    memberStatusId: "all",
    memberStatusIds: [],
    employmentStatusIds: [],
    workStatusIds: [],
    representativeIds: [],
    workStatusActive: "all",
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
    setAppliedFilters(normalizeEmployerEmploymentFilters({
      ...withoutWorkerBenefitRoleFilters(filters),
      ...normalizedRoleFilters,
    }));
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
    setFilters(normalizeEmployerEmploymentFilters(newFilters));
  }, []);

  const handleClearFilters = useCallback(() => {
    setNameIdInput("");
    setContactInput("");
    setSsnInput("");
    setAppliedSsn("");
    setSsnGeneration(value => value + 1);
    setFilters(defaultFilters);
    setAppliedNameId("");
    setAppliedContact("");
    setAppliedFilters(defaultFilters);
    setPage(1);
    setSelectedIds(new Set());
  }, []);

  const handleRemoveAppliedFilter = useCallback((
    key: keyof WorkerFilters | "contactSearch" | "nameIdSearch",
  ) => {
    if (key === "nameIdSearch") {
      setNameIdInput("");
      setAppliedNameId("");
    } else if (key === "contactSearch") {
      setContactInput("");
      setAppliedContact("");
    } else if (key === "isSubscriber" || key === "isDependent") {
      const removeRole = (current: WorkerFilters): WorkerFilters => {
        const next = { ...current };
        if (key === "isSubscriber") {
          delete next.isSubscriber;
          delete next.subscriberSinceFrom;
          delete next.subscriberSinceThrough;
        } else {
          delete next.isDependent;
          delete next.dependentSinceFrom;
          delete next.dependentSinceThrough;
        }
        return next;
      };
      setFilters(removeRole);
      setAppliedFilters(removeRole);
    } else {
      const reset: Partial<Record<keyof WorkerFilters, unknown>> = {
        employerIds: [],
        employerId: "all",
        employmentMode: "ever",
        employmentStatusIds: [],
        employerTypeId: "all",
        jobTitle: "",
        hasMultipleEmployers: false,
        memberStatusIds: [],
        memberStatusId: "all",
        bargainingUnitIds: [],
        bargainingUnitId: "all",
        workStatusIds: [],
        workStatusActive: "all",
        benefitId: "all",
        benefitIds: [],
        representativeIds: [],
        representativeId: "all",
        fieldRepIds: [],
        isSteward: "all",
        contactStatus: "all",
      };
      if (key === "employmentStatusIds" || key === "employmentMode") {
        reset.employmentMode = "ever";
        reset.employmentStatusIds = [];
      }
      const value = reset[key];
      const patch = { [key]: value } as Partial<WorkerFilters>;
      if (key === "employerIds") {
        Object.assign(patch, { employerId: "all", employmentMode: undefined, employmentStatusIds: [] });
      } else if (key === "memberStatusIds") {
        patch.memberStatusId = "all";
      } else if (key === "bargainingUnitIds") {
        patch.bargainingUnitId = "all";
      } else if (key === "benefitIds") {
        patch.benefitId = "all";
      } else if (key === "representativeIds") {
        patch.representativeId = "all";
      } else if (key === "employmentMode" || key === "employmentStatusIds") {
        Object.assign(patch, { employmentMode: "ever", employmentStatusIds: [] });
      }
      setFilters(current => normalizeEmployerEmploymentFilters({ ...current, ...patch }));
      setAppliedFilters(current => normalizeEmployerEmploymentFilters({ ...current, ...patch }));
    }
    setPage(1);
  }, []);

  // A trust.benefits deployment may be turned off while this page is open.
  // Clear both generations of local state immediately; filterParams below also
  // gates the request during the transition before this effect runs.
  useEffect(() => {
    if (!componentConfigsLoaded) return;
    if (!trustBenefitsEnabled) {
      setFilters((current) => ({ ...withoutWorkerBenefitRoleFilters(current), benefitId: "all", benefitIds: [] }));
      setAppliedFilters((current) => ({ ...withoutWorkerBenefitRoleFilters(current), benefitId: "all", benefitIds: [] }));
      setPage(1);
      setSelectedIds(new Set());
    }
  }, [trustBenefitsEnabled, componentConfigsLoaded]);

  useEffect(() => {
    if (!authReady) return;
    if (cardcheckEnabled) return;
    setFilters(current => current.memberStatusIds?.length ? { ...current, memberStatusIds: [] } : current);
    setAppliedFilters(current => current.memberStatusIds?.length ? { ...current, memberStatusIds: [] } : current);
  }, [authReady, cardcheckEnabled]);

  useEffect(() => {
    if (!authReady) return;
    if (bargainingUnitsEnabled) return;
    setFilters(current => current.bargainingUnitIds?.length ? { ...current, bargainingUnitIds: [] } : current);
    setAppliedFilters(current => current.bargainingUnitIds?.length ? { ...current, bargainingUnitIds: [] } : current);
  }, [authReady, bargainingUnitsEnabled]);

  useEffect(() => {
    if (!authReady) return;
    if (politicalEnabled) return;
    setFilters(current => current.representativeIds?.length ? { ...current, representativeIds: [] } : current);
    setAppliedFilters(current => current.representativeIds?.length ? { ...current, representativeIds: [] } : current);
  }, [authReady, politicalEnabled]);

  useEffect(() => {
    if (!authReady) return;
    if (stewardEnabled) return;
    setFilters(current => current.isSteward && current.isSteward !== "all" ? { ...current, isSteward: "all" } : current);
    setAppliedFilters(current => current.isSteward && current.isSteward !== "all" ? { ...current, isSteward: "all" } : current);
  }, [authReady, stewardEnabled]);

  useEffect(() => {
    if (!authReady) return;
    if (btuEnabled) return;
    setFilters(current => current.fieldRepIds?.length ? { ...current, fieldRepIds: [] } : current);
    setAppliedFilters(current => current.fieldRepIds?.length ? { ...current, fieldRepIds: [] } : current);
  }, [authReady, btuEnabled]);

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
    employerId: appliedFilters.employerIds?.length === 1
      ? appliedFilters.employerIds[0]
      : appliedFilters.employerId,
    employerIds: appliedFilters.employerIds ?? [],
    employerTypeId: appliedFilters.employerTypeId,
    bargainingUnitId: bargainingUnitsEnabled
      ? appliedFilters.bargainingUnitIds?.length === 1
        ? appliedFilters.bargainingUnitIds[0]
        : appliedFilters.bargainingUnitId
      : "all",
    bargainingUnitIds: bargainingUnitsEnabled ? appliedFilters.bargainingUnitIds ?? [] : [],
    benefitId: trustBenefitsEnabled ? appliedFilters.benefitId : "all",
    benefitIds: trustBenefitsEnabled && appliedFilters.benefitIds?.length
      ? appliedFilters.benefitIds
      : trustBenefitsEnabled && appliedFilters.benefitId !== "all" ? [appliedFilters.benefitId] : [],
    contactStatus: appliedFilters.contactStatus,
    hasMultipleEmployers: appliedFilters.hasMultipleEmployers,
    jobTitle: appliedFilters.jobTitle,
    memberStatusId: cardcheckEnabled
      ? appliedFilters.memberStatusIds?.length === 1
        ? appliedFilters.memberStatusIds[0]
        : appliedFilters.memberStatusId
      : "all",
    memberStatusIds: cardcheckEnabled ? appliedFilters.memberStatusIds ?? [] : [],
    representativeId: politicalEnabled
      ? appliedFilters.representativeIds?.length === 1
        ? appliedFilters.representativeIds[0]
        : appliedFilters.representativeId
      : undefined,
    representativeIds: politicalEnabled ? appliedFilters.representativeIds ?? [] : [],
    employmentMode: appliedFilters.employmentMode,
    employmentStatusIds: appliedFilters.employmentMode === "custom"
      ? appliedFilters.employmentStatusIds ?? []
      : [],
    workStatusIds: appliedFilters.workStatusIds ?? [],
    workStatusActive: normalizeWorkerDirectoryFilters({
      workStatusActive: appliedFilters.workStatusActive,
    }).workStatusActive,
    isSteward: stewardEnabled && appliedFilters.isSteward !== "all" ? appliedFilters.isSteward : undefined,
    fieldRepIds: btuEnabled ? appliedFilters.fieldRepIds ?? [] : [],
    ...appliedBenefitRoleFilters,
  }), [
    appliedNameId,
    appliedContact,
    sortOrder,
    sortBy,
    appliedFilters,
    appliedBenefitRoleFilters,
    bargainingUnitsEnabled,
    trustBenefitsEnabled,
    cardcheckEnabled,
    politicalEnabled,
    stewardEnabled,
    btuEnabled,
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

  const handleSecureExport = useCallback(async (filters: Record<string, unknown>) => {
    try {
      const blobUrl = URL.createObjectURL(
        await fetchSecureWorkerExport(filters, appliedSsn),
      );
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
          onClearFilters={handleClearFilters}
          onRemoveAppliedFilter={handleRemoveAppliedFilter}
          enableContextualFilters
           enableBenefitRoleFilters={trustBenefitsEnabled}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      </main>
    </div>
  );
}
