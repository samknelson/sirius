import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  BAO_PREMIUM_COVERAGE_TIERS,
  BAO_PREMIUM_COVERAGE_TIER_LABELS,
  type BaoPremiumRateWithBenefit,
  type BaoPremiumCoverageTier,
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

interface RateFormState {
  benefitId: string;
  coverageTier: BaoPremiumCoverageTier | "";
  rate: string;
  effectiveYmd: string;
}

const EMPTY_FORM: RateFormState = {
  benefitId: "",
  coverageTier: "",
  rate: "",
  effectiveYmd: "",
};

export default function BaoPremiumRatesPage() {
  usePageTitle("Premium Rates");
  const { toast } = useToast();

  const [filterBenefitId, setFilterBenefitId] = useState<string>(ALL);
  const [filterTier, setFilterTier] = useState<string>(ALL);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BaoPremiumRateWithBenefit | null>(null);
  const [form, setForm] = useState<RateFormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<BaoPremiumRateWithBenefit | null>(null);

  const { data: benefits = [] } = useQuery<TrustBenefitOption[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const { data: rates = [], isLoading } = useQuery<BaoPremiumRateWithBenefit[]>({
    queryKey: ["/api/sitespecific/bao/premium/rates", filterBenefitId, filterTier],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterBenefitId !== ALL) params.set("benefitId", filterBenefitId);
      if (filterTier !== ALL) params.set("coverageTier", filterTier);
      const response = await fetch(
        `/api/sitespecific/bao/premium/rates?${params.toString()}`,
      );
      if (!response.ok) throw new Error("Failed to load premium rates");
      return response.json();
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/sitespecific/bao/premium/rates"],
    });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        benefitId: form.benefitId,
        coverageTier: form.coverageTier,
        rate: form.rate,
        effectiveYmd: form.effectiveYmd,
      };
      if (editing) {
        return apiRequest(
          "PATCH",
          `/api/sitespecific/bao/premium/rates/${editing.id}`,
          payload,
        );
      }
      return apiRequest("POST", "/api/sitespecific/bao/premium/rates", payload);
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
      apiRequest("DELETE", `/api/sitespecific/bao/premium/rates/${id}`),
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

  const openEdit = (rate: BaoPremiumRateWithBenefit) => {
    setEditing(rate);
    setForm({
      benefitId: rate.benefitId,
      coverageTier: rate.coverageTier,
      rate: rate.rate,
      effectiveYmd: (rate.effectiveYmd ?? "").slice(0, 10),
    });
    setDialogOpen(true);
  };

  const formValid =
    form.benefitId &&
    form.coverageTier &&
    form.rate.trim() !== "" &&
    Number.isFinite(Number(form.rate)) &&
    Number(form.rate) >= 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveYmd);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-premium-rates-title">
            Premium Rates
          </h1>
          <p className="text-muted-foreground text-sm">
            Effective-dated monthly provider premiums by benefit and coverage tier
            (number of covered people). Lookups use the latest rate on or before the
            benefit month.
          </p>
        </div>
        <Button onClick={openAdd} data-testid="button-add-premium-rate">
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
            <Label>Coverage Tier</Label>
            <Select value={filterTier} onValueChange={setFilterTier}>
              <SelectTrigger className="w-56" data-testid="select-filter-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All tiers</SelectItem>
                {BAO_PREMIUM_COVERAGE_TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {BAO_PREMIUM_COVERAGE_TIER_LABELS[t]}
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
              data-testid="text-no-premium-rates"
            >
              No premium rates found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Benefit</TableHead>
                  <TableHead>Coverage Tier</TableHead>
                  <TableHead>Monthly Premium</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.id} data-testid={`row-premium-rate-${r.id}`}>
                    <TableCell data-testid={`text-rate-benefit-${r.id}`}>
                      {r.benefitName ?? "—"}
                    </TableCell>
                    <TableCell data-testid={`text-rate-tier-${r.id}`}>
                      {BAO_PREMIUM_COVERAGE_TIER_LABELS[r.coverageTier] ?? r.coverageTier}
                    </TableCell>
                    <TableCell data-testid={`text-rate-amount-${r.id}`}>
                      ${formatRate(r.rate)}
                    </TableCell>
                    <TableCell data-testid={`text-rate-effective-${r.id}`}>
                      {formatYmd(r.effectiveYmd)}
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
            <DialogTitle>{editing ? "Edit Premium Rate" : "Add Premium Rate"}</DialogTitle>
            <DialogDescription>
              Monthly provider premium for a benefit and coverage tier, effective
              from the given date.
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
              <Label>Coverage Tier</Label>
              <Select
                value={form.coverageTier}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, coverageTier: v as BaoPremiumCoverageTier }))
                }
              >
                <SelectTrigger data-testid="select-rate-tier">
                  <SelectValue placeholder="Select a coverage tier" />
                </SelectTrigger>
                <SelectContent>
                  {BAO_PREMIUM_COVERAGE_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {BAO_PREMIUM_COVERAGE_TIER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Monthly Premium ($)</Label>
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
              {saveMutation.isPending && (
                <Loader2 size={16} className="mr-2 animate-spin" />
              )}
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
              This will permanently remove the premium rate for{" "}
              {deleting?.benefitName ?? "this benefit"} (
              {deleting
                ? BAO_PREMIUM_COVERAGE_TIER_LABELS[deleting.coverageTier] ??
                  deleting.coverageTier
                : ""}
              ) effective {formatYmd(deleting?.effectiveYmd)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-rate">
              Cancel
            </AlertDialogCancel>
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
