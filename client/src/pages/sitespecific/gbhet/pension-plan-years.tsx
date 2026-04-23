import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Calendar, Loader2, Calculator, Settings } from "lucide-react";

interface PlanYear {
  id: string;
  year: number;
  accrualMethod: string;
  contributionPct: string | null;
  specialDesignationContributionPct: string | null;
  qualificationThresholdHours: string;
  specialDesignationMonthlyHours: string;
  shareValue: string | null;
  notes: string | null;
  data: Record<string, any> | null;
}

const API_BASE = "/api/sitespecific/gbhet/pension/plan-years";

export default function PensionPlanYearsPage() {
  usePageTitle("Pension Plan Years");
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    year: new Date().getFullYear(),
    accrualMethod: "contribution_pct" as string,
    contributionPct: "",
    specialDesignationContributionPct: "",
    qualificationThresholdHours: "500",
    specialDesignationMonthlyHours: "135",
    shareValue: "",
    notes: "",
  });

  const { data: planYears = [], isLoading } = useQuery<PlanYear[]>({
    queryKey: [API_BASE],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const body: any = {
        year: data.year,
        accrualMethod: data.accrualMethod,
        qualificationThresholdHours: data.qualificationThresholdHours || "500",
        specialDesignationMonthlyHours: data.specialDesignationMonthlyHours || "135",
        notes: data.notes || null,
        contributionPct: data.accrualMethod === "contribution_pct" && data.contributionPct ? data.contributionPct : null,
        specialDesignationContributionPct: data.accrualMethod === "contribution_pct" && data.specialDesignationContributionPct ? data.specialDesignationContributionPct : null,
        shareValue: data.shareValue || null,
      };
      return apiRequest("POST", API_BASE, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDialogOpen(false);
      toast({ title: "Plan year created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create plan year", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const body: any = {
        year: data.year,
        accrualMethod: data.accrualMethod,
        qualificationThresholdHours: data.qualificationThresholdHours || "500",
        specialDesignationMonthlyHours: data.specialDesignationMonthlyHours || "135",
        notes: data.notes || null,
        contributionPct: data.accrualMethod === "contribution_pct" && data.contributionPct ? data.contributionPct : null,
        specialDesignationContributionPct: data.accrualMethod === "contribution_pct" && data.specialDesignationContributionPct ? data.specialDesignationContributionPct : null,
        shareValue: data.shareValue || null,
      };
      return apiRequest("PATCH", `${API_BASE}/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDialogOpen(false);
      setEditingId(null);
      toast({ title: "Plan year updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update plan year", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `${API_BASE}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDeleteConfirmId(null);
      toast({ title: "Plan year deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete plan year", description: error.message, variant: "destructive" });
    },
  });

  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchResult, setBatchResult] = useState<any>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedTriggerAccountId, setSelectedTriggerAccountId] = useState<string>("");

  const { data: slaConfig, isLoading: slaConfigLoading } = useQuery<{
    accountId: string | null;
    triggerAccountId: string | null;
    accounts: Array<{ id: string; name: string }>;
  }>({
    queryKey: ["/api/sitespecific/gbhet/pension/sla/config"],
    queryFn: async () => {
      const res = await fetch("/api/sitespecific/gbhet/pension/sla/config");
      if (!res.ok) throw new Error("Failed to load SLA config");
      return res.json();
    },
  });

  useEffect(() => {
    if (slaConfig?.accountId && !selectedAccountId) {
      setSelectedAccountId(slaConfig.accountId);
    }
    if (slaConfig?.triggerAccountId && !selectedTriggerAccountId) {
      setSelectedTriggerAccountId(slaConfig.triggerAccountId);
    }
  }, [slaConfig?.accountId, slaConfig?.triggerAccountId]);

  const saveConfigMutation = useMutation({
    mutationFn: async (params: { accountId?: string; triggerAccountId?: string }) => {
      return await apiRequest("PUT", "/api/sitespecific/gbhet/pension/sla/config", params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/gbhet/pension/sla/config"] });
      toast({ title: "SLA configuration saved" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save SLA configuration", description: error.message, variant: "destructive" });
    },
  });

  const [selectedVarContribSourceId, setSelectedVarContribSourceId] = useState<string>("");
  const [selectedVarContribTargetId, setSelectedVarContribTargetId] = useState<string>("");

  const { data: varContribConfig, isLoading: varContribConfigLoading } = useQuery<{
    sourceAccountId: string | null;
    targetAccountId: string | null;
    accounts: Array<{ id: string; name: string }>;
  }>({
    queryKey: ["/api/sitespecific/gbhet/pension/variable-contribution/config"],
    queryFn: async () => {
      const res = await fetch("/api/sitespecific/gbhet/pension/variable-contribution/config");
      if (!res.ok) throw new Error("Failed to load variable contribution config");
      return res.json();
    },
  });

  useEffect(() => {
    if (varContribConfig?.sourceAccountId && !selectedVarContribSourceId) {
      setSelectedVarContribSourceId(varContribConfig.sourceAccountId);
    }
    if (varContribConfig?.targetAccountId && !selectedVarContribTargetId) {
      setSelectedVarContribTargetId(varContribConfig.targetAccountId);
    }
  }, [varContribConfig?.sourceAccountId, varContribConfig?.targetAccountId]);

  const saveVarContribConfigMutation = useMutation({
    mutationFn: async (params: { sourceAccountId?: string; targetAccountId?: string }) => {
      return await apiRequest("PUT", "/api/sitespecific/gbhet/pension/variable-contribution/config", params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/gbhet/pension/variable-contribution/config"] });
      toast({ title: "Variable contribution configuration saved" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save variable contribution configuration", description: error.message, variant: "destructive" });
    },
  });

  const batchSlaMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/sitespecific/gbhet/pension/sla/compute/all", {
        configId: "batch",
      });
    },
    onSuccess: (data) => {
      setBatchConfirmOpen(false);
      setBatchResult(data);
      let desc = `Processed ${data.processed}: ${data.created} created, ${data.updated} updated, ${data.skipped} unchanged, ${data.errors} errors.`;
      if (data.varContribResult) {
        const vc = data.varContribResult;
        desc += ` Shares: ${vc.created} created, ${vc.updated} updated.`;
      }
      toast({
        title: "Batch SLA and Shares Complete",
        description: desc,
      });
    },
    onError: (error: any) => {
      setBatchConfirmOpen(false);
      toast({ title: "Batch SLA Failed", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setFormData({
      year: new Date().getFullYear(),
      accrualMethod: "contribution_pct",
      contributionPct: "",
      specialDesignationContributionPct: "",
      qualificationThresholdHours: "500",
      specialDesignationMonthlyHours: "135",
      shareValue: "",
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (planYear: PlanYear) => {
    setEditingId(planYear.id);
    setFormData({
      year: planYear.year,
      accrualMethod: planYear.accrualMethod,
      contributionPct: planYear.contributionPct || "",
      specialDesignationContributionPct: planYear.specialDesignationContributionPct || "",
      qualificationThresholdHours: planYear.qualificationThresholdHours || "500",
      specialDesignationMonthlyHours: planYear.specialDesignationMonthlyHours || "135",
      shareValue: planYear.shareValue || "",
      notes: planYear.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const formatAccrualMethod = (method: string) => {
    switch (method) {
      case "tiered": return "Tiered (Hours-to-%)";
      case "contribution_pct": return "Contribution %";
      default: return method;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12" data-testid="loading-plan-years">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" data-testid="text-page-title">Pension Plan Year Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Configure the accrual method, qualification thresholds, and share values for each plan year.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-plan-year">
          <Plus className="h-4 w-4 mr-2" />
          Add Plan Year
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Year</TableHead>
                <TableHead>Accrual Method</TableHead>
                <TableHead className="text-right">Contribution %</TableHead>
                <TableHead className="text-right">Special Desig. %</TableHead>
                <TableHead className="text-right">Qualification Hrs</TableHead>
                <TableHead className="text-right">Special Desig. Hrs/Mo</TableHead>
                <TableHead className="text-right">Share Value</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {planYears.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No plan years configured yet. Click "Add Plan Year" to get started.
                  </TableCell>
                </TableRow>
              ) : (
                planYears.map((py) => (
                  <TableRow key={py.id} data-testid={`row-plan-year-${py.year}`}>
                    <TableCell className="font-medium" data-testid={`text-plan-year-${py.year}`}>
                      {py.year}
                    </TableCell>
                    <TableCell>
                      <Badge variant={py.accrualMethod === "tiered" ? "secondary" : "default"} data-testid={`badge-method-${py.year}`}>
                        {formatAccrualMethod(py.accrualMethod)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-contribution-pct-${py.year}`}>
                      {py.accrualMethod === "contribution_pct" && py.contributionPct
                        ? `${parseFloat(py.contributionPct)}%`
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-special-contribution-pct-${py.year}`}>
                      {py.accrualMethod === "contribution_pct" && py.specialDesignationContributionPct
                        ? `${parseFloat(py.specialDesignationContributionPct)}%`
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-qual-hours-${py.year}`}>
                      {parseFloat(py.qualificationThresholdHours).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-special-hours-${py.year}`}>
                      {parseFloat(py.specialDesignationMonthlyHours)}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-share-value-${py.year}`}>
                      {py.shareValue ? `$${parseFloat(py.shareValue).toFixed(2)}` : "-"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground" data-testid={`text-notes-${py.year}`}>
                      {py.notes || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(py)} data-testid={`button-edit-plan-year-${py.year}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteConfirmId(py.id)} data-testid={`button-delete-plan-year-${py.year}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                {editingId ? "Edit Plan Year" : "Add Plan Year"}
              </div>
            </DialogTitle>
            <DialogDescription>
              Configure the pension plan parameters for a specific year.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  min={1990}
                  max={2100}
                  value={formData.year}
                  onChange={(e) => setFormData(prev => ({ ...prev, year: parseInt(e.target.value) || 0 }))}
                  required
                  data-testid="input-year"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="accrualMethod">Accrual Method</Label>
                <Select
                  value={formData.accrualMethod}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, accrualMethod: value }))}
                >
                  <SelectTrigger data-testid="select-accrual-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tiered">Tiered (Hours-to-%)</SelectItem>
                    <SelectItem value="contribution_pct">Contribution %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.accrualMethod === "contribution_pct" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contributionPct">Contribution %</Label>
                  <Input
                    id="contributionPct"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="e.g. 5.00"
                    value={formData.contributionPct}
                    onChange={(e) => setFormData(prev => ({ ...prev, contributionPct: e.target.value }))}
                    data-testid="input-contribution-pct"
                  />
                  <p className="text-xs text-muted-foreground">
                    Rate for regular workers.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialDesignationContributionPct">Special Desig. %</Label>
                  <Input
                    id="specialDesignationContributionPct"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="e.g. 3.00"
                    value={formData.specialDesignationContributionPct}
                    onChange={(e) => setFormData(prev => ({ ...prev, specialDesignationContributionPct: e.target.value }))}
                    data-testid="input-special-designation-contribution-pct"
                  />
                  <p className="text-xs text-muted-foreground">
                    Rate for special designation workers.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qualificationThresholdHours">Qualification Hours</Label>
                <Input
                  id="qualificationThresholdHours"
                  type="number"
                  step="1"
                  min="0"
                  value={formData.qualificationThresholdHours}
                  onChange={(e) => setFormData(prev => ({ ...prev, qualificationThresholdHours: e.target.value }))}
                  required
                  data-testid="input-qualification-hours"
                />
                <p className="text-xs text-muted-foreground">
                  Minimum hours required to qualify for benefits this year.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="specialDesignationMonthlyHours">Special Desig. Hrs/Month</Label>
                <Input
                  id="specialDesignationMonthlyHours"
                  type="number"
                  step="1"
                  min="0"
                  value={formData.specialDesignationMonthlyHours}
                  onChange={(e) => setFormData(prev => ({ ...prev, specialDesignationMonthlyHours: e.target.value }))}
                  required
                  data-testid="input-special-designation-hours"
                />
                <p className="text-xs text-muted-foreground">
                  Fixed monthly hours for special designation workers.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shareValue">Start-of-Year Share Value ($)</Label>
              <Input
                id="shareValue"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 125.50"
                value={formData.shareValue}
                onChange={(e) => setFormData(prev => ({ ...prev, shareValue: e.target.value }))}
                data-testid="input-share-value"
              />
              <p className="text-xs text-muted-foreground">
                The VDB share value at the start of the year, used to determine variable benefit earned from SLA contributions. Leave blank if not yet determined.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Optional notes about this plan year..."
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="resize-none"
                data-testid="input-notes"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-plan-year">
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? "Save Changes" : "Create Plan Year"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Plan Year</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this plan year configuration? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">SLA Settings</CardTitle>
          </div>
          <CardDescription>
            Configure ledger accounts for SLA processing. The output account receives computed SLA charges.
            The trigger account (optional) enables automatic SLA contribution calculation when entries are posted to it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {slaConfigLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="sla-output-account">Output Account</label>
                <Select
                  value={selectedAccountId || slaConfig?.accountId || ""}
                  onValueChange={setSelectedAccountId}
                >
                  <SelectTrigger className="w-[280px]" data-testid="select-sla-account" id="sla-output-account">
                    <SelectValue placeholder="Select output account" />
                  </SelectTrigger>
                  <SelectContent>
                    {(slaConfig?.accounts || []).map((acct) => (
                      <SelectItem key={acct.id} value={acct.id}>
                        {acct.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="sla-trigger-account">Trigger Account</label>
                <Select
                  value={selectedTriggerAccountId || slaConfig?.triggerAccountId || ""}
                  onValueChange={setSelectedTriggerAccountId}
                >
                  <SelectTrigger className="w-[280px]" data-testid="select-sla-trigger-account" id="sla-trigger-account">
                    <SelectValue placeholder="Select trigger account (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {(slaConfig?.accounts || []).map((acct) => (
                      <SelectItem key={acct.id} value={acct.id}>
                        {acct.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  When entries are posted to this account, the SLA Contribution plugin automatically computes a corresponding SLA charge at the plan year contribution rate.
                </p>
              </div>
              <Button
                size="sm"
                disabled={saveConfigMutation.isPending || (!selectedAccountId && !selectedTriggerAccountId)}
                onClick={() => {
                  const params: { accountId?: string; triggerAccountId?: string } = {};
                  if (selectedAccountId) params.accountId = selectedAccountId;
                  if (selectedTriggerAccountId) params.triggerAccountId = selectedTriggerAccountId;
                  saveConfigMutation.mutate(params);
                }}
                data-testid="button-save-sla-config"
              >
                {saveConfigMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Variable Contribution Settings</CardTitle>
          </div>
          <CardDescription>
            Configure accounts for the Variable Contribution plugin. When SLA entries appear on the source account,
            the plugin divides the SLA amount by the start-of-year share value to compute shares (points) and writes
            the result to the target account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {varContribConfigLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="var-contrib-source-account">Source Account (SLA Output)</label>
                <Select
                  value={selectedVarContribSourceId || varContribConfig?.sourceAccountId || ""}
                  onValueChange={setSelectedVarContribSourceId}
                >
                  <SelectTrigger className="w-[280px]" data-testid="select-var-contrib-source-account" id="var-contrib-source-account">
                    <SelectValue placeholder="Select source account" />
                  </SelectTrigger>
                  <SelectContent>
                    {(varContribConfig?.accounts || []).map((acct) => (
                      <SelectItem key={acct.id} value={acct.id}>
                        {acct.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The account where SLA contributions are posted. The plugin watches this account for new entries.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="var-contrib-target-account">Target Account (Shares/Points)</label>
                <Select
                  value={selectedVarContribTargetId || varContribConfig?.targetAccountId || ""}
                  onValueChange={setSelectedVarContribTargetId}
                >
                  <SelectTrigger className="w-[280px]" data-testid="select-var-contrib-target-account" id="var-contrib-target-account">
                    <SelectValue placeholder="Select target account" />
                  </SelectTrigger>
                  <SelectContent>
                    {(varContribConfig?.accounts || []).map((acct) => (
                      <SelectItem key={acct.id} value={acct.id}>
                        {acct.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The account where computed shares (points) are written for each worker.
                </p>
              </div>
              <Button
                size="sm"
                disabled={saveVarContribConfigMutation.isPending || (!selectedVarContribSourceId && !selectedVarContribTargetId)}
                onClick={() => {
                  const params: { sourceAccountId?: string; targetAccountId?: string } = {};
                  if (selectedVarContribSourceId) params.sourceAccountId = selectedVarContribSourceId;
                  if (selectedVarContribTargetId) params.targetAccountId = selectedVarContribTargetId;
                  saveVarContribConfigMutation.mutate(params);
                }}
                data-testid="button-save-var-contrib-config"
              >
                {saveVarContribConfigMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Batch SLA and Shares Computation</CardTitle>
          <CardDescription>
            Run the SLA and shares calculation across all plan years. For tiered years, computes Benefit Schedule Rate x Accrual Tier %
            for each worker based on their total hours. For contribution % years, reconciles trigger account entries with SLA output entries.
            After SLA processing, reconciles variable contributions to fill any missing shares entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {batchResult && (
            <div className="rounded-md border p-4 space-y-3 text-sm" data-testid="batch-result-summary">
              <p className="font-medium">Last Batch Result (Combined)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <span className="text-muted-foreground">Processed:</span>{" "}
                  <span className="font-medium">{batchResult.processed}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  <span className="font-medium">{batchResult.created}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Updated:</span>{" "}
                  <span className="font-medium">{batchResult.updated}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Errors:</span>{" "}
                  <span className="font-medium">{batchResult.errors}</span>
                </div>
              </div>
              {batchResult.contributionResult && (
                <div className="border-t pt-2 mt-2">
                  <p className="font-medium text-xs text-muted-foreground mb-1">Contribution % Reconciliation</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <span className="text-muted-foreground">Processed:</span>{" "}
                      <span className="font-medium">{batchResult.contributionResult.processed}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Created:</span>{" "}
                      <span className="font-medium">{batchResult.contributionResult.created}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Updated:</span>{" "}
                      <span className="font-medium">{batchResult.contributionResult.updated}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Skipped:</span>{" "}
                      <span className="font-medium">{batchResult.contributionResult.skipped}</span>
                    </div>
                  </div>
                </div>
              )}
              {batchResult.varContribResult && (
                <div className="border-t pt-2 mt-2">
                  <p className="font-medium text-xs text-muted-foreground mb-1">Shares Reconciliation</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <span className="text-muted-foreground">Processed:</span>{" "}
                      <span className="font-medium">{batchResult.varContribResult.processed}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Created:</span>{" "}
                      <span className="font-medium">{batchResult.varContribResult.created}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Updated:</span>{" "}
                      <span className="font-medium">{batchResult.varContribResult.updated}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Skipped:</span>{" "}
                      <span className="font-medium">{batchResult.varContribResult.skipped}</span>
                    </div>
                  </div>
                </div>
              )}
              {batchResult.errorDetails?.length > 0 && (
                <div className="text-destructive text-xs mt-2">
                  {batchResult.errorDetails.map((e: string, i: number) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button
            onClick={() => setBatchConfirmOpen(true)}
            disabled={batchSlaMutation.isPending}
            data-testid="button-batch-sla"
          >
            {batchSlaMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            {batchSlaMutation.isPending ? "Computing..." : "Run Batch SLA and Shares"}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={batchConfirmOpen} onOpenChange={setBatchConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Batch SLA and Shares Computation</DialogTitle>
            <DialogDescription>
              This will calculate the Simple Life Allocation for all workers across all tiered plan years,
              reconcile contribution % plan years by checking for trigger account entries that are missing SLA output entries,
              and then reconcile variable contributions to fill any missing shares entries.
              Existing entries will be updated if values have changed. This may take a while for large datasets.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchConfirmOpen(false)} data-testid="button-cancel-batch">
              Cancel
            </Button>
            <Button
              disabled={batchSlaMutation.isPending}
              onClick={() => batchSlaMutation.mutate()}
              data-testid="button-confirm-batch"
            >
              {batchSlaMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Run Batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
