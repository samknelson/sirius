import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  BAO_DP_TIER_TRANSITIONS,
  BAO_DP_TIER_TRANSITION_LABELS,
  BAO_DP_TIER_TRANSITION_SCENARIOS,
  type BaoDpRateWithBenefit,
  type BaoDpTierTransition,
} from "@shared/schema/sitespecific/bao/schema";

interface TrustBenefitOption {
  id: string;
  name: string;
}

const ALL = "__all__";

function formatYmd(value: string | null | undefined): string {
  if (!value) return "—";
  const ymd = value.slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}`;
}

function formatRate(rate: string): string {
  const n = Number(rate);
  if (!Number.isFinite(n)) return rate;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** A confirmed (non-provisional) $0.00 rate means "covered at no charge". */
function isConfirmedNoCharge(rate: { rate: string; provisional: boolean }): boolean {
  return !rate.provisional && Math.abs(Number(rate.rate)) < 0.005;
}

interface RateFormState {
  benefitId: string;
  tierTransition: BaoDpTierTransition | "";
  rate: string;
  effectiveYmd: string;
  provisional: boolean;
}

const EMPTY_FORM: RateFormState = {
  benefitId: "",
  tierTransition: "",
  rate: "",
  effectiveYmd: "",
  provisional: false,
};

export default function BaoDpRatesPage() {
  usePageTitle("Domestic Partner Rates");
  const { toast } = useToast();

  const [filterBenefitId, setFilterBenefitId] = useState<string>(ALL);
  const [filterTransition, setFilterTransition] = useState<string>(ALL);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BaoDpRateWithBenefit | null>(null);
  const [form, setForm] = useState<RateFormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<BaoDpRateWithBenefit | null>(null);

  const { data: benefits = [] } = useQuery<TrustBenefitOption[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const ratesQueryKey = [
    "/api/sitespecific/bao/dp/rates",
    filterBenefitId,
    filterTransition,
  ] as const;

  const { data: rates = [], isLoading } = useQuery<BaoDpRateWithBenefit[]>({
    queryKey: ratesQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterBenefitId !== ALL) params.set("benefitId", filterBenefitId);
      if (filterTransition !== ALL) params.set("tierTransition", filterTransition);
      const response = await fetch(
        `/api/sitespecific/bao/dp/rates?${params.toString()}`,
      );
      if (!response.ok) throw new Error("Failed to load DP rates");
      return response.json();
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/dp/rates"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        benefitId: form.benefitId,
        tierTransition: form.tierTransition,
        rate: form.rate,
        effectiveYmd: form.effectiveYmd,
        provisional: form.provisional,
      };
      if (editing) {
        return apiRequest("PATCH", `/api/sitespecific/bao/dp/rates/${editing.id}`, payload);
      }
      return apiRequest("POST", "/api/sitespecific/bao/dp/rates", payload);
    },
    onSuccess: async () => {
      await invalidate();
      toast({ title: editing ? "Rate updated" : "Rate added" });
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save rate",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/sitespecific/bao/dp/rates/${id}`),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Rate deleted" });
      setDeleting(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete rate",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (rate: BaoDpRateWithBenefit) => {
    setEditing(rate);
    setForm({
      benefitId: rate.benefitId,
      tierTransition: rate.tierTransition,
      rate: rate.rate,
      effectiveYmd: (rate.effectiveYmd ?? "").slice(0, 10),
      provisional: rate.provisional,
    });
    setDialogOpen(true);
  };

  const formValid =
    form.benefitId &&
    form.tierTransition &&
    form.rate.trim() !== "" &&
    Number.isFinite(Number(form.rate)) &&
    Number(form.rate) >= 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveYmd);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-dp-rates-title">
            Domestic Partner Rates
          </h1>
          <p className="text-muted-foreground text-sm">
            Effective-dated monthly Domestic Partner <strong>member charges</strong> by
            benefit and coverage-tier transition — the amount collected from the member,
            not the imputed-income figure (which is never charged). Lookups use the latest
            rate on or before the date in question. A confirmed $0.00 rate means the
            transition is covered at no charge; provisional rows are placeholders, not
            confirmed values, and are never billed or waived.
          </p>
          <ul
            className="text-muted-foreground text-sm mt-2 space-y-0.5"
            data-testid="list-dp-transition-scenarios"
          >
            {BAO_DP_TIER_TRANSITIONS.map((t) => (
              <li key={t} data-testid={`text-dp-transition-scenario-${t}`}>
                <strong>{BAO_DP_TIER_TRANSITION_LABELS[t]}</strong> —{" "}
                {BAO_DP_TIER_TRANSITION_SCENARIOS[t]}
              </li>
            ))}
            <li>
              The DP's children are the dependents enrolled as <strong>Step Child</strong>;
              every other non-DP dependent counts as the member's own.
            </li>
          </ul>
        </div>
        <Button onClick={openAdd} data-testid="button-add-dp-rate">
          <Plus size={16} className="mr-2" />
          Add Rate
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label>Benefit</Label>
            <Select value={filterBenefitId} onValueChange={setFilterBenefitId}>
              <SelectTrigger className="w-64" data-testid="select-filter-benefit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All benefits</SelectItem>
                {benefits.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Transition</Label>
            <Select value={filterTransition} onValueChange={setFilterTransition}>
              <SelectTrigger className="w-56" data-testid="select-filter-transition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All transitions</SelectItem>
                {BAO_DP_TIER_TRANSITIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {BAO_DP_TIER_TRANSITION_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : rates.length === 0 ? (
            <div
              className="text-center py-12 text-muted-foreground"
              data-testid="text-no-dp-rates"
            >
              No Domestic Partner rates found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Benefit</TableHead>
                  <TableHead>Transition</TableHead>
                  <TableHead>Monthly Member Charge</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.id} data-testid={`row-dp-rate-${r.id}`}>
                    <TableCell data-testid={`text-rate-benefit-${r.id}`}>
                      {r.benefitName ?? "—"}
                    </TableCell>
                    <TableCell data-testid={`text-rate-transition-${r.id}`}>
                      {BAO_DP_TIER_TRANSITION_LABELS[r.tierTransition] ?? r.tierTransition}
                    </TableCell>
                    <TableCell data-testid={`text-rate-amount-${r.id}`}>
                      {isConfirmedNoCharge(r) ? "No charge" : `$${formatRate(r.rate)}`}
                    </TableCell>
                    <TableCell data-testid={`text-rate-effective-${r.id}`}>
                      {formatYmd(r.effectiveYmd)}
                    </TableCell>
                    <TableCell data-testid={`text-rate-status-${r.id}`}>
                      {r.provisional ? (
                        <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
                          Provisional
                        </Badge>
                      ) : isConfirmedNoCharge(r) ? (
                        <Badge variant="secondary">Confirmed — no charge</Badge>
                      ) : (
                        <Badge variant="secondary">Confirmed</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(r)}
                        data-testid={`button-edit-rate-${r.id}`}
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(r)}
                        data-testid={`button-delete-rate-${r.id}`}
                      >
                        <Trash2 size={16} className="text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditing(null);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit DP Rate" : "Add DP Rate"}</DialogTitle>
            <DialogDescription>
              Monthly member charge for a benefit and coverage-tier transition, effective
              from the given date. Enter $0.00 for a transition confirmed as no charge.
              Mark a rate provisional when it is a placeholder rather than a confirmed
              value — provisional rates are never billed and never treated as free.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Benefit</Label>
              <Select
                value={form.benefitId}
                onValueChange={(v) => setForm((f) => ({ ...f, benefitId: v }))}
              >
                <SelectTrigger data-testid="select-rate-benefit">
                  <SelectValue placeholder="Select a benefit" />
                </SelectTrigger>
                <SelectContent>
                  {benefits.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Transition</Label>
              <Select
                value={form.tierTransition}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, tierTransition: v as BaoDpTierTransition }))
                }
              >
                <SelectTrigger data-testid="select-rate-transition">
                  <SelectValue placeholder="Select a transition" />
                </SelectTrigger>
                <SelectContent>
                  {BAO_DP_TIER_TRANSITIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {BAO_DP_TIER_TRANSITION_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.tierTransition && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="text-rate-transition-scenario"
                >
                  {BAO_DP_TIER_TRANSITION_SCENARIOS[form.tierTransition]}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Monthly Member Charge ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                data-testid="input-rate-amount"
              />
            </div>
            <div className="space-y-1">
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={form.effectiveYmd}
                onChange={(e) => setForm((f) => ({ ...f, effectiveYmd: e.target.value }))}
                data-testid="input-rate-effective"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label>Provisional</Label>
                <p className="text-xs text-muted-foreground">
                  Placeholder rate — not a confirmed value. Never billed and never
                  treated as no charge.
                </p>
              </div>
              <Switch
                checked={form.provisional}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, provisional: checked }))
                }
                data-testid="switch-rate-provisional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-rate"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!formValid || saveMutation.isPending}
              data-testid="button-save-rate"
            >
              {saveMutation.isPending && <Loader2 size={16} className="mr-2 animate-spin" />}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rate?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the rate for{" "}
              {deleting?.benefitName ?? "this benefit"} (
              {deleting
                ? BAO_DP_TIER_TRANSITION_LABELS[deleting.tierTransition] ??
                  deleting.tierTransition
                : ""}
              ) effective {formatYmd(deleting?.effectiveYmd)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-rate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-rate"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
