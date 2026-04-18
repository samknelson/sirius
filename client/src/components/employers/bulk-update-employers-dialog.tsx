import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { EmployerType } from "@shared/schema";

interface Industry {
  id: string;
  name: string;
}

interface Company {
  id: string;
  name: string;
}

interface BulkUpdateEmployersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  showCompany: boolean;
  companies: Company[];
  onComplete: () => void;
}

const UNCHANGED = "__unchanged__";
const NONE = "__none__";

export function BulkUpdateEmployersDialog({
  open,
  onOpenChange,
  selectedIds,
  showCompany,
  companies,
  onComplete,
}: BulkUpdateEmployersDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [industryId, setIndustryId] = useState<string>(UNCHANGED);
  const [typeId, setTypeId] = useState<string>(UNCHANGED);
  const [companyId, setCompanyId] = useState<string>(UNCHANGED);
  const [activeValue, setActiveValue] = useState<string>(UNCHANGED);

  const { data: employerTypes = [] } = useQuery<EmployerType[]>({
    queryKey: ["/api/options/employer-type"],
    enabled: open,
  });

  const { data: industries = [] } = useQuery<Industry[]>({
    queryKey: ["/api/options/industry"],
    enabled: open,
  });

  const reset = () => {
    setIndustryId(UNCHANGED);
    setTypeId(UNCHANGED);
    setCompanyId(UNCHANGED);
    setActiveValue(UNCHANGED);
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {};
    if (industryId !== UNCHANGED) {
      payload.industryId = industryId === NONE ? null : industryId;
    }
    if (typeId !== UNCHANGED) {
      payload.typeId = typeId === NONE ? null : typeId;
    }
    if (showCompany && companyId !== UNCHANGED) {
      payload.companyId = companyId === NONE ? null : companyId;
    }
    if (activeValue !== UNCHANGED) {
      payload.isActive = activeValue === "active";
    }
    return payload;
  };

  const errorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return "Unknown error";
  };

  const bulkMutation = useMutation({
    mutationFn: async ({ ids, payload }: { ids: string[]; payload: Record<string, unknown> }) => {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            await apiRequest("PUT", `/api/employers/${id}`, payload);
            return { id, ok: true as const };
          } catch (error: unknown) {
            return { id, ok: false as const, error: errorMessage(error) };
          }
        })
      );
      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.length - succeeded;
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers"] });
      if (failed === 0) {
        toast({
          title: "Bulk update complete",
          description: `Updated ${succeeded} employer${succeeded === 1 ? "" : "s"}.`,
        });
      } else {
        toast({
          title: "Bulk update completed with errors",
          description: `Updated ${succeeded}, ${failed} failed.`,
          variant: "destructive",
        });
      }
      reset();
      onOpenChange(false);
      onComplete();
    },
    onError: (error: unknown) => {
      toast({
        title: "Bulk update failed",
        description: errorMessage(error) || "Unable to apply bulk update.",
        variant: "destructive",
      });
    },
  });

  const payload = buildPayload();
  const hasChanges = Object.keys(payload).length > 0;

  const handleSubmit = () => {
    const currentPayload = buildPayload();
    console.log("[BulkUpdate] handleSubmit", {
      industryId,
      typeId,
      companyId,
      activeValue,
      showCompany,
      currentPayload,
      selectedIds,
    });
    if (Object.keys(currentPayload).length === 0 || selectedIds.length === 0) return;
    bulkMutation.mutate({ ids: [...selectedIds], payload: currentPayload });
  };

  const handleOpenChange = (next: boolean) => {
    if (bulkMutation.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-bulk-update-employers">
        <DialogHeader>
          <DialogTitle>Bulk Update {selectedIds.length} Employer{selectedIds.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Only fields you change will be applied. Leave a field as "Leave unchanged" to skip it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="bulk-industry">Industry</Label>
            <Select value={industryId} onValueChange={setIndustryId}>
              <SelectTrigger id="bulk-industry" data-testid="select-bulk-industry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED} data-testid="select-item-bulk-industry-unchanged">Leave unchanged</SelectItem>
                <SelectItem value={NONE} data-testid="select-item-bulk-industry-none">
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
                {industries.map((industry) => (
                  <SelectItem key={industry.id} value={industry.id} data-testid={`select-item-bulk-industry-${industry.id}`}>
                    {industry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-type">Type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger id="bulk-type" data-testid="select-bulk-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED} data-testid="select-item-bulk-type-unchanged">Leave unchanged</SelectItem>
                <SelectItem value={NONE} data-testid="select-item-bulk-type-none">
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
                {employerTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id} data-testid={`select-item-bulk-type-${type.id}`}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showCompany && (
            <div className="space-y-2">
              <Label htmlFor="bulk-company">Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger id="bulk-company" data-testid="select-bulk-company">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCHANGED} data-testid="select-item-bulk-company-unchanged">Leave unchanged</SelectItem>
                  <SelectItem value={NONE} data-testid="select-item-bulk-company-none">
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id} data-testid={`select-item-bulk-company-${company.id}`}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="bulk-active">Active</Label>
            <Select value={activeValue} onValueChange={setActiveValue}>
              <SelectTrigger id="bulk-active" data-testid="select-bulk-active">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED} data-testid="select-item-bulk-active-unchanged">Leave unchanged</SelectItem>
                <SelectItem value="active" data-testid="select-item-bulk-active-true">Active</SelectItem>
                <SelectItem value="inactive" data-testid="select-item-bulk-active-false">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={bulkMutation.isPending}
            data-testid="button-bulk-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!hasChanges || bulkMutation.isPending}
            data-testid="button-bulk-apply"
          >
            {bulkMutation.isPending ? "Applying..." : `Apply to ${selectedIds.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
