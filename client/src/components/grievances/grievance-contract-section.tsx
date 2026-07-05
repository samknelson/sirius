import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronUp, ChevronDown, X, Plus, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { GrievanceContractSectionPicker } from "./grievance-contract-section-picker";

interface ContractOption {
  id: string;
  name: string;
}

interface LinkedSection {
  id: string;
  sectionId: string;
  sectionNumber: string | null;
  name: string;
  isStub: boolean;
  sequence: number;
  articleId: string;
  articleNumber: string | null;
  articleName: string;
}

interface ContractLinkResponse {
  contract: { contractId: string; contractName: string } | null;
  sections: LinkedSection[];
}

interface GrievanceContractSectionProps {
  grievanceId: string;
}

/**
 * Live edit manager for a grievance's linked contract and the CBA sections it
 * alleges were violated. A grievance links to at most one contract; the
 * contract cannot be changed or cleared while sections are still linked (a hard
 * block the server enforces and surfaces here as a toast).
 */
export function GrievanceContractSection({ grievanceId }: GrievanceContractSectionProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [choosingContract, setChoosingContract] = useState(false);
  const [pendingContractId, setPendingContractId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data, isLoading } = useQuery<ContractLinkResponse>({
    queryKey: ["/api/grievances", grievanceId, "contract"],
    queryFn: async () => {
      const res = await fetch(`/api/grievances/${grievanceId}/contract`);
      if (!res.ok) throw new Error("Failed to load contract link");
      return res.json();
    },
  });

  const { data: contracts = [] } = useQuery<ContractOption[]>({
    queryKey: ["/api/contracts"],
    enabled: choosingContract,
  });

  const contract = data?.contract ?? null;
  const sections = data?.sections ?? [];
  const hasSections = sections.length > 0;

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["/api/grievances", grievanceId, "contract"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["/api/grievances", grievanceId, "contract", "catalog"],
    });
  };

  const onSetContract = async () => {
    if (!pendingContractId) {
      toast({ title: "Select a contract", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("PUT", `/api/grievances/${grievanceId}/contract`, {
        contractId: pendingContractId,
      });
      await refresh();
      setChoosingContract(false);
      setPendingContractId("");
      toast({ title: "Contract linked" });
    } catch (error: any) {
      toast({
        title: "Failed to link contract",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onClearContract = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/grievances/${grievanceId}/contract`);
      await refresh();
      toast({ title: "Contract cleared" });
    } catch (error: any) {
      toast({
        title: "Failed to clear contract",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onAddSections = async (sectionIds: string[]) => {
    if (sectionIds.length === 0) return;
    setBusy(true);
    try {
      await apiRequest("POST", `/api/grievances/${grievanceId}/contract/sections`, {
        sectionIds,
      });
      await refresh();
      setPickerOpen(false);
      toast({ title: "Sections added" });
    } catch (error: any) {
      toast({
        title: "Failed to add sections",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onRemoveSection = async (linkId: string) => {
    setBusy(true);
    try {
      await apiRequest(
        "DELETE",
        `/api/grievances/${grievanceId}/contract/sections/${linkId}`,
      );
      await refresh();
      toast({ title: "Section removed" });
    } catch (error: any) {
      toast({
        title: "Failed to remove section",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onMove = async (linkId: string, direction: "up" | "down") => {
    setBusy(true);
    try {
      await apiRequest(
        "PATCH",
        `/api/grievances/${grievanceId}/contract/sections/${linkId}/move`,
        { direction },
      );
      await refresh();
    } catch (error: any) {
      toast({
        title: "Failed to reorder section",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="card-grievance-contract">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>CBA Provisions Violated</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : !contract && !choosingContract ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" data-testid="text-no-contract">
              No contract linked.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setChoosingContract(true)}
              data-testid="button-link-contract"
            >
              <Plus size={14} className="mr-1" />
              Link contract
            </Button>
          </div>
        ) : choosingContract ? (
          <div className="space-y-3 border rounded-lg p-3" data-testid="form-choose-contract">
            <Select
              value={pendingContractId}
              onValueChange={setPendingContractId}
              disabled={busy}
            >
              <SelectTrigger data-testid="select-contract">
                <SelectValue placeholder="Select a contract" />
              </SelectTrigger>
              <SelectContent>
                {contracts.map((c) => (
                  <SelectItem key={c.id} value={c.id} data-testid={`option-contract-${c.id}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={onSetContract}
                data-testid="button-save-contract"
              >
                <Check size={14} className="mr-1" />
                Link
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setChoosingContract(false);
                  setPendingContractId("");
                }}
                data-testid="button-cancel-contract"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Contract</p>
                <p className="text-foreground font-medium truncate" data-testid="text-contract-name">
                  {contract!.contractName}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setPendingContractId(contract!.contractId);
                    setChoosingContract(true);
                  }}
                  data-testid="button-change-contract"
                >
                  Change
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={onClearContract}
                  data-testid="button-clear-contract"
                >
                  <X size={14} className="mr-1" />
                  Clear
                </Button>
              </div>
            </div>

            {hasSections && (
              <p className="text-xs text-muted-foreground" data-testid="text-contract-locked-hint">
                Remove all sections to change or clear the contract.
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Sections</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setPickerOpen(true)}
                  data-testid="button-add-sections"
                >
                  <Plus size={14} className="mr-1" />
                  Add sections
                </Button>
              </div>

              {sections.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-sections-linked">
                  No sections added.
                </p>
              ) : (
                <div className="space-y-2">
                  {sections.map((s, index) => (
                    <div
                      key={s.id}
                      className="flex items-start justify-between gap-2 border rounded-lg px-3 py-2"
                      data-testid={`row-linked-section-${s.id}`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-sm font-medium text-foreground"
                            data-testid={`text-linked-section-${s.id}`}
                          >
                            {s.sectionNumber ? `${s.sectionNumber}. ` : ""}
                            {s.name}
                          </span>
                          {s.isStub && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">
                              stub
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {s.articleNumber ? `${s.articleNumber}. ` : ""}
                          {s.articleName}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy || index === 0}
                          onClick={() => onMove(s.id, "up")}
                          data-testid={`button-move-up-section-${s.id}`}
                        >
                          <ChevronUp size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy || index === sections.length - 1}
                          onClick={() => onMove(s.id, "down")}
                          data-testid={`button-move-down-section-${s.id}`}
                        >
                          <ChevronDown size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          onClick={() => onRemoveSection(s.id)}
                          data-testid={`button-remove-section-${s.id}`}
                        >
                          <X size={14} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>

      {contract && (
        <GrievanceContractSectionPicker
          grievanceId={grievanceId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          linkedSectionIds={sections.map((s) => s.sectionId)}
          onConfirm={onAddSections}
          busy={busy}
        />
      )}
    </Card>
  );
}

/**
 * Read-only display of a grievance's linked contract and the ordered CBA
 * sections it alleges were violated, for the grievance details page.
 */
export function GrievanceContractSummary({ grievanceId }: GrievanceContractSectionProps) {
  const { data, isLoading } = useQuery<ContractLinkResponse>({
    queryKey: ["/api/grievances", grievanceId, "contract"],
    queryFn: async () => {
      const res = await fetch(`/api/grievances/${grievanceId}/contract`);
      if (!res.ok) throw new Error("Failed to load contract link");
      return res.json();
    },
  });

  const contract = data?.contract ?? null;
  const sections = data?.sections ?? [];

  return (
    <Card data-testid="card-grievance-contract-summary">
      <CardHeader>
        <CardTitle>CBA Provisions Violated</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : !contract ? (
          <p className="text-muted-foreground text-sm" data-testid="text-summary-no-contract">
            No contract linked.
          </p>
        ) : (
          <>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Contract</p>
              <p className="text-foreground font-medium" data-testid="text-summary-contract-name">
                {contract.contractName}
              </p>
            </div>
            {sections.length === 0 ? (
              <p className="text-muted-foreground text-sm" data-testid="text-summary-no-sections">
                No sections cited.
              </p>
            ) : (
              <ol className="list-decimal pl-5 space-y-1" data-testid="list-summary-sections">
                {sections.map((s) => (
                  <li key={s.id} data-testid={`item-summary-section-${s.id}`}>
                    <span className="text-foreground">
                      {s.sectionNumber ? `${s.sectionNumber}. ` : ""}
                      {s.name}
                    </span>
                    {s.isStub && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-2">
                        stub
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-2">
                      ({s.articleNumber ? `${s.articleNumber}. ` : ""}
                      {s.articleName})
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
