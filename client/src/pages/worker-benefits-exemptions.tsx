import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { pluginManifestQueryKey } from "@/plugins/_core";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pencil, Trash2 } from "lucide-react";
import type { TrustBenefitEligibilityExemption } from "@shared/schema";

interface EligibilityPlugin {
  id: string;
  name: string;
  description: string;
}

interface TrustBenefitOption {
  id: string;
  name: string;
  isActive: boolean;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ymdFromValue(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

function ExemptionFormDialog({
  open,
  onOpenChange,
  mode,
  workerId,
  exemption,
  plugins,
  benefits,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  workerId: string;
  exemption?: TrustBenefitEligibilityExemption | null;
  plugins: EligibilityPlugin[];
  benefits: TrustBenefitOption[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [benefitId, setBenefitId] = useState<string>("");
  const [startYmd, setStartYmd] = useState<string>("");
  const [endYmd, setEndYmd] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && exemption) {
      setBenefitId(exemption.benefitId ?? "");
      setStartYmd(ymdFromValue(exemption.startYmd));
      setEndYmd(ymdFromValue(exemption.endYmd));
      setDescription(exemption.description ?? "");
      setSelectedPlugins(exemption.eligibilityPlugins ?? []);
    } else {
      setBenefitId("");
      setStartYmd(todayYmd());
      setEndYmd("");
      setDescription("");
      setSelectedPlugins([]);
    }
  }, [open, mode, exemption]);

  function togglePlugin(id: string) {
    setSelectedPlugins((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        benefitId,
        eligibilityPlugins: selectedPlugins,
        startYmd,
        endYmd: endYmd || null,
        description: description.trim() || null,
      };
      if (mode === "create") {
        return await apiRequest("POST", `/api/workers/${workerId}/benefits/exemptions`, body);
      }
      return await apiRequest("PATCH", `/api/benefits/exemptions/${exemption!.id}`, body);
    },
    onSuccess: () => {
      toast({ title: mode === "create" ? "Exemption created" : "Exemption updated" });
      onSaved();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to save", variant: "destructive" });
    },
  });

  function handleSave() {
    if (!benefitId) {
      toast({ title: "Validation", description: "A benefit is required.", variant: "destructive" });
      return;
    }
    if (!startYmd) {
      toast({ title: "Validation", description: "Start date is required.", variant: "destructive" });
      return;
    }
    if (selectedPlugins.length === 0) {
      toast({
        title: "Validation",
        description: "Select at least one eligibility check.",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Eligibility Exemption" : "Edit Eligibility Exemption"}</DialogTitle>
          <DialogDescription>
            Exempt this worker from specific eligibility checks for a date range. Leave the end date
            blank for an open-ended exemption.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="exemption-benefit">Benefit</Label>
            <Select value={benefitId} onValueChange={setBenefitId}>
              <SelectTrigger id="exemption-benefit" data-testid="select-exemption-benefit">
                <SelectValue placeholder="Choose a benefit" />
              </SelectTrigger>
              <SelectContent>
                {benefits.map((b) => (
                  <SelectItem key={b.id} value={b.id} data-testid={`option-benefit-${b.id}`}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="exemption-start">Start date</Label>
              <Input
                id="exemption-start"
                type="date"
                value={startYmd}
                onChange={(e) => setStartYmd(e.target.value)}
                data-testid="input-exemption-start"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exemption-end">End date (optional)</Label>
              <Input
                id="exemption-end"
                type="date"
                value={endYmd}
                onChange={(e) => setEndYmd(e.target.value)}
                data-testid="input-exemption-end"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Exempt from eligibility checks</Label>
            <div className="max-h-40 overflow-auto rounded-md border p-2 space-y-1">
              {plugins.length === 0 && (
                <div className="text-sm text-muted-foreground">No eligibility checks available.</div>
              )}
              {plugins.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedPlugins.includes(p.id)}
                    onCheckedChange={() => togglePlugin(p.id)}
                    data-testid={`checkbox-plugin-${p.id}`}
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Select at least one eligibility check to exempt this worker from.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="exemption-description">Description (optional)</Label>
            <Textarea
              id="exemption-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Reason for this exemption"
              data-testid="input-exemption-description"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
              data-testid="button-cancel-exemption"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-exemption">
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExemptionsContent() {
  const { worker } = useWorkerLayout();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canEdit = hasPermission("staff");

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingExemption, setEditingExemption] = useState<TrustBenefitEligibilityExemption | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrustBenefitEligibilityExemption | null>(null);

  const { data: rows = [], isLoading } = useQuery<TrustBenefitEligibilityExemption[]>({
    queryKey: ["/api/workers", worker.id, "benefits-exemptions"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${worker.id}/benefits/exemptions`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: plugins = [] } = useQuery<EligibilityPlugin[]>({
    queryKey: pluginManifestQueryKey("trust-eligibility"),
  });

  const { data: benefits = [] } = useQuery<TrustBenefitOption[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const pluginName = (id: string) => plugins.find((p) => p.id === id)?.name || id;
  const benefitName = (id: string) => benefits.find((b) => b.id === id)?.name || id;

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "benefits-exemptions"] });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/benefits/exemptions/${id}`),
    onSuccess: () => {
      toast({ title: "Exemption deleted" });
      refetch();
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to delete", variant: "destructive" });
    },
  });

  function openCreate() {
    setFormMode("create");
    setEditingExemption(null);
    setIsFormOpen(true);
  }

  function openEdit(exemption: TrustBenefitEligibilityExemption) {
    setFormMode("edit");
    setEditingExemption(exemption);
    setIsFormOpen(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Eligibility Exemptions</CardTitle>
          {canEdit && (
            <Button onClick={openCreate} data-testid="button-create-exemption">
              New Exemption
            </Button>
          )}
        </div>
        <CardDescription>
          Exemptions let this worker skip selected eligibility checks for a date range.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground" data-testid="text-no-exemptions">
            No eligibility exemptions recorded.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Benefit</TableHead>
                <TableHead>Exempt from</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Description</TableHead>
                {canEdit && <TableHead className="w-[100px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid={`row-exemption-${row.id}`}>
                  <TableCell data-testid={`text-benefit-${row.id}`}>{benefitName(row.benefitId)}</TableCell>
                  <TableCell data-testid={`text-plugins-${row.id}`}>
                    {row.eligibilityPlugins && row.eligibilityPlugins.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.eligibilityPlugins.map((p) => (
                          <Badge key={p} variant="outline">{pluginName(p)}</Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell data-testid={`text-start-${row.id}`}>{ymdFromValue(row.startYmd)}</TableCell>
                  <TableCell data-testid={`text-end-${row.id}`}>{ymdFromValue(row.endYmd) || "—"}</TableCell>
                  <TableCell data-testid={`text-description-${row.id}`}>{row.description || "—"}</TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(row)}
                          data-testid={`button-edit-${row.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(row)}
                          data-testid={`button-delete-${row.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {canEdit && (
        <ExemptionFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          mode={formMode}
          workerId={worker.id}
          exemption={editingExemption}
          plugins={plugins}
          benefits={benefits}
          onSaved={refetch}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete exemption?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the eligibility exemption. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function WorkerBenefitsExemptionsPage() {
  return (
    <WorkerLayout activeTab="benefits-exemptions">
      <ExemptionsContent />
    </WorkerLayout>
  );
}
