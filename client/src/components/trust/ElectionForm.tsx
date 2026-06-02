import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  WorkerTrustElection,
  CreateWorkerTrustElectionRequest,
  UpdateWorkerTrustElectionRequest,
} from "@shared/schema";

interface EmployerOption {
  id: string;
  name: string;
}
interface PolicyOption {
  id: string;
  name: string;
}
interface TrustBenefitOption {
  id: string;
  name: string;
}
interface RelationOption {
  id: string;
  relationTypeName: string | null;
  otherWorker: { displayName: string | null; given: string | null; family: string | null } | null;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ymdFromDate(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function invalidateElectionQueries(workerId: string, electionId?: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId, "trust-elections"] });
  queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId, "trust-elections", "current"] });
  if (electionId) {
    queryClient.invalidateQueries({ queryKey: ["/api/trust-elections", electionId] });
  }
}

interface ElectionFormProps {
  mode: "create" | "edit";
  workerId: string;
  election?: WorkerTrustElection | null;
  enabled?: boolean;
  onSaved?: (saved: WorkerTrustElection) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}

export function ElectionForm({
  mode,
  workerId,
  election,
  enabled = true,
  onSaved,
  onCancel,
  cancelLabel = "Cancel",
}: ElectionFormProps) {
  const { toast } = useToast();
  const [employerId, setEmployerId] = useState<string>("");
  const [policyId, setPolicyId] = useState<string>("");
  const [startYmd, setStartYmd] = useState<string>("");
  const [endYmd, setEndYmd] = useState<string>("");
  const [benefitIds, setBenefitIds] = useState<string[]>([]);
  const [relationshipIds, setRelationshipIds] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    if (mode === "edit" && election) {
      setEmployerId(election.employerId ?? "");
      setPolicyId(election.policyId ?? "");
      setStartYmd(ymdFromDate(election.startYmd));
      setEndYmd(ymdFromDate(election.endYmd));
      setBenefitIds(election.benefitIds ?? []);
      setRelationshipIds(election.relationshipIds ?? []);
    } else if (mode === "create") {
      setEmployerId("");
      setPolicyId("");
      setStartYmd(todayYmd());
      setEndYmd("");
      setBenefitIds([]);
      setRelationshipIds([]);
    }
  }, [enabled, mode, election]);

  const { data: employers = [] } = useQuery<EmployerOption[]>({
    queryKey: ["/api/employers/lookup"],
    enabled,
  });
  const { data: policies = [] } = useQuery<PolicyOption[]>({
    queryKey: ["/api/policies"],
    enabled,
  });
  const { data: benefits = [] } = useQuery<TrustBenefitOption[]>({
    queryKey: ["/api/trust-benefits"],
    enabled,
  });
  const { data: relations = [] } = useQuery<RelationOption[]>({
    queryKey: ["/api/workers", workerId, "relations"],
    enabled,
  });

  const createMutation = useMutation({
    mutationFn: async (body: CreateWorkerTrustElectionRequest): Promise<WorkerTrustElection> =>
      (await apiRequest("POST", `/api/workers/${workerId}/trust-elections`, body)) as WorkerTrustElection,
    onSuccess: (saved) => {
      toast({ title: "Election created" });
      invalidateElectionQueries(workerId, saved?.id);
      onSaved?.(saved);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to create", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (body: UpdateWorkerTrustElectionRequest): Promise<WorkerTrustElection> =>
      (await apiRequest("PATCH", `/api/trust-elections/${election!.id}`, body)) as WorkerTrustElection,
    onSuccess: (saved) => {
      toast({ title: "Election updated" });
      invalidateElectionQueries(workerId, saved?.id ?? election?.id);
      onSaved?.(saved);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to update", variant: "destructive" });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function toggle(arr: string[], setArr: (v: string[]) => void, id: string) {
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  }

  function handleSave() {
    if (!employerId) {
      toast({ title: "Validation", description: "Employer is required.", variant: "destructive" });
      return;
    }
    if (!policyId) {
      toast({ title: "Validation", description: "Policy is required.", variant: "destructive" });
      return;
    }
    if (!startYmd) {
      toast({ title: "Validation", description: "Start date is required.", variant: "destructive" });
      return;
    }
    if (mode === "create") {
      createMutation.mutate({
        employerId,
        policyId,
        startYmd,
        endYmd: endYmd || null,
        benefitIds,
        relationshipIds,
      });
    } else {
      updateMutation.mutate({
        employerId,
        policyId,
        startYmd,
        endYmd: endYmd || null,
        benefitIds,
        relationshipIds,
      });
    }
  }

  function relationLabel(r: RelationOption): string {
    const name = r.otherWorker
      ? [r.otherWorker.given, r.otherWorker.family].filter(Boolean).join(" ").trim() ||
        r.otherWorker.displayName ||
        ""
      : "";
    const type = r.relationTypeName || "relation";
    return `${name || r.id} (${type})`;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Employer</Label>
        <Select value={employerId} onValueChange={setEmployerId}>
          <SelectTrigger data-testid="select-employer">
            <SelectValue placeholder="Choose an employer" />
          </SelectTrigger>
          <SelectContent>
            {employers.map((e) => (
              <SelectItem key={e.id} value={e.id} data-testid={`option-employer-${e.id}`}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Policy</Label>
        <Select value={policyId} onValueChange={setPolicyId}>
          <SelectTrigger data-testid="select-policy">
            <SelectValue placeholder="Choose a policy" />
          </SelectTrigger>
          <SelectContent>
            {policies.map((p) => (
              <SelectItem key={p.id} value={p.id} data-testid={`option-policy-${p.id}`}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start-ymd">Start date</Label>
          <Input
            id="start-ymd"
            type="date"
            value={startYmd}
            onChange={(e) => setStartYmd(e.target.value)}
            data-testid="input-start-ymd"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end-ymd">End date (optional)</Label>
          <Input
            id="end-ymd"
            type="date"
            value={endYmd}
            onChange={(e) => setEndYmd(e.target.value)}
            data-testid="input-end-ymd"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Benefits</Label>
        <div className="max-h-40 overflow-auto rounded-md border p-2 space-y-1">
          {benefits.length === 0 && (
            <div className="text-sm text-muted-foreground">No benefits available.</div>
          )}
          {benefits.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={benefitIds.includes(b.id)}
                onCheckedChange={() => toggle(benefitIds, setBenefitIds, b.id)}
                data-testid={`checkbox-benefit-${b.id}`}
              />
              {b.name}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Covered relationships</Label>
        <div className="max-h-40 overflow-auto rounded-md border p-2 space-y-1">
          {relations.length === 0 && (
            <div className="text-sm text-muted-foreground">No worker relations on file.</div>
          )}
          {relations.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={relationshipIds.includes(r.id)}
                onCheckedChange={() => toggle(relationshipIds, setRelationshipIds, r.id)}
                data-testid={`checkbox-relation-${r.id}`}
              />
              {relationLabel(r)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            data-testid="button-cancel"
          >
            {cancelLabel}
          </Button>
        )}
        <Button onClick={handleSave} disabled={isPending} data-testid="button-save">
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
