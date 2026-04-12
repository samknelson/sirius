import { useState, useCallback, useMemo } from "react";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WorkersTable, WorkerFilters } from "@/components/workers/workers-table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Loader2 } from "lucide-react";

interface PaginatedWorkersResponse {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface BulkParticipant {
  id: string;
  messageId: string;
  contactId: string;
  commId: string | null;
  data: unknown;
  createdAt: string;
}

function BulkMessageRecipientsAddContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedJobTitle, setAppliedJobTitle] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<"lastName" | "firstName" | "employer">("lastName");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  const { data: paginatedData, isLoading: workersLoading } = useQuery<PaginatedWorkersResponse>({
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

  const { data: existingParticipants = [] } = useQuery<BulkParticipant[]>({
    queryKey: ["/api/bulk-messages", bulkMessage.id, "participants"],
    queryFn: () => apiRequest("GET", `/api/bulk-messages/${bulkMessage.id}/participants`),
  });

  const disabledIds = useMemo(() => {
    return new Set(existingParticipants.map(p => p.contactId));
  }, [existingParticipants]);

  const workers = paginatedData?.data ?? [];
  const total = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

  const addMutation = useMutation({
    mutationFn: async (contactIds: string[]) => {
      let added = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const contactId of contactIds) {
        try {
          const res = await fetch(`/api/bulk-messages/${bulkMessage.id}/participants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contactId }),
            credentials: "include",
          });
          if (res.ok) {
            added++;
          } else if (res.status === 409) {
            skipped++;
          } else {
            const body = await res.json().catch(() => ({ message: "Unknown error" }));
            errors.push(body.message || `Failed for contact ${contactId}`);
          }
        } catch {
          errors.push(`Network error for contact ${contactId}`);
        }
      }
      return { added, skipped, errors };
    },
    onSuccess: (result) => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "participants"] });
      if (result.errors.length > 0) {
        toast({
          title: "Partially added",
          description: `${result.added} added, ${result.errors.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Recipients added",
          description: `${result.added} recipient${result.added !== 1 ? "s" : ""} added successfully.${result.skipped ? ` ${result.skipped} already existed.` : ""}`,
        });
      }
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "participants"] });
      toast({
        title: "Error adding recipients",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddSelected = () => {
    if (selectedIds.size === 0) return;
    addMutation.mutate(Array.from(selectedIds));
  };

  return (
    <Card data-testid="card-bulk-recipients-add">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle data-testid="text-recipients-add-title">Add Recipients</CardTitle>
        {selectedIds.size > 0 && (
          <Button
            onClick={handleAddSelected}
            disabled={addMutation.isPending}
            data-testid="button-add-selected-recipients"
          >
            {addMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            Add {selectedIds.size} Recipient{selectedIds.size !== 1 ? "s" : ""}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <WorkersTable
          workers={workers}
          isLoading={workersLoading}
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
          disabledIds={disabledIds}
        />
      </CardContent>
    </Card>
  );
}

export default function BulkMessageRecipientsAddPage() {
  return (
    <BulkMessageLayout activeTab="recipients-add">
      <BulkMessageRecipientsAddContent />
    </BulkMessageLayout>
  );
}
