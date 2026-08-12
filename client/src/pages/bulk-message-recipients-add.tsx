import { useState, useCallback, useMemo } from "react";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WorkersTable, WorkerFilters } from "@/components/workers/workers-table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
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
  // Apply-button model: search text and filter controls accumulate locally and
  // only hit the server when Apply is pressed (same as the main workers page).
  const [nameIdInput, setNameIdInput] = useState("");
  const [contactInput, setContactInput] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [sortBy, setSortBy] = useState<"lastName" | "firstName" | "employer">("lastName");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
  const [appliedNameId, setAppliedNameId] = useState("");
  const [appliedContact, setAppliedContact] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<WorkerFilters>(defaultFilters);

  const handleApplySearch = useCallback(() => {
    setAppliedNameId(nameIdInput);
    setAppliedContact(contactInput);
    setAppliedFilters(filters);
    setPage(1);
  }, [nameIdInput, contactInput, filters]);

  const handleFiltersChange = useCallback((newFilters: WorkerFilters) => {
    setFilters(newFilters);
  }, []);

  const { data: paginatedData, isLoading: workersLoading } = useQuery<PaginatedWorkersResponse>({
    queryKey: ["/api/workers/with-details/paginated", {
      page,
      pageSize,
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
    }],
  });

  const { data: existingParticipants = [] } = useQuery<BulkParticipant[]>({
    queryKey: ["/api/bulk-messages", bulkMessage.id, "participants"],
    queryFn: () => apiRequest("GET", `/api/bulk-messages/${bulkMessage.id}/participants`),
  });

  const media = Array.isArray(bulkMessage.medium) ? bulkMessage.medium : [bulkMessage.medium];
  const mediaCount = media.length;

  const disabledIds = useMemo(() => {
    const contactMediaCounts: Record<string, number> = {};
    for (const p of existingParticipants) {
      contactMediaCounts[p.contactId] = (contactMediaCounts[p.contactId] || 0) + 1;
    }
    const result = new Set<string>();
    for (const [contactId, count] of Object.entries(contactMediaCounts)) {
      if (count >= mediaCount) {
        result.add(contactId);
      }
    }
    return result;
  }, [existingParticipants, mediaCount]);

  const workers = paginatedData?.data ?? [];
  const total = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

  const addMutation = useMutation({
    mutationFn: async (contactIds: string[]) => {
      let totalCreated = 0;
      let totalSkipped = 0;
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
            const body = await res.json().catch(() => ({ created: [], skipped: 0 }));
            totalCreated += Array.isArray(body.created) ? body.created.length : 1;
            totalSkipped += body.skipped || 0;
          } else if (res.status === 409) {
            totalSkipped++;
          } else {
            const body = await res.json().catch(() => ({ message: "Unknown error" }));
            errors.push(body.message || `Failed for contact ${contactId}`);
          }
        } catch {
          errors.push(`Network error for contact ${contactId}`);
        }
      }
      return { totalCreated, totalSkipped, errors };
    },
    onSuccess: (result) => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "participants"] });
      if (result.errors.length > 0) {
        toast({
          title: "Partially added",
          description: `${result.totalCreated} participant(s) added, ${result.errors.length} contact(s) failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Recipients added",
          description: `${result.totalCreated} participant${result.totalCreated !== 1 ? "s" : ""} added successfully.${result.totalSkipped ? ` ${result.totalSkipped} already existed.` : ""}`,
        });
      }
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "participants"] });
      toast({
        title: "Error adding recipients",
        description: getApiErrorMessage(error, "An unexpected error occurred"),
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
