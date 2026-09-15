import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BaoEeContributionRateWithBenefit } from "@shared/schema/sitespecific/bao/schema";

interface TrustBenefitOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface RateForm {
  benefitId: string;
  rate: string;
  effectiveYmd: string;
}

const EMPTY_FORM: RateForm = { benefitId: "", rate: "", effectiveYmd: "" };

function formatYmd(value: string): string {
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

function formatRate(rate: string): string {
  const amount = Number(rate);
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : rate;
}

export function PolicyContributionRatesCard({
  policyId,
  canManage,
}: {
  policyId: string;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BaoEeContributionRateWithBenefit | null>(null);
  const [deleting, setDeleting] = useState<BaoEeContributionRateWithBenefit | null>(null);
  const [form, setForm] = useState<RateForm>(EMPTY_FORM);
  const queryKey = ["/api/policies", policyId, "bao-ee-contribution-rates"] as const;
  const endpoint = `/api/policies/${policyId}/bao-ee-contribution-rates`;

  const { data: rates = [], isLoading } = useQuery<BaoEeContributionRateWithBenefit[]>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("Failed to load employee contribution rates");
      return response.json();
    },
  });
  const { data: benefits = [] } = useQuery<TrustBenefitOption[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { ...form };
      return editing
        ? apiRequest("PATCH", `${endpoint}/${editing.id}`, payload)
        : apiRequest("POST", endpoint, payload);
    },
    onSuccess: async () => {
      await invalidate();
      toast({ title: editing ? "Contribution rate updated" : "Contribution rate added" });
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (error: Error) =>
      toast({
        title: "Failed to save contribution rate",
        description: error.message,
        variant: "destructive",
      }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${endpoint}/${id}`),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Contribution rate deleted" });
      setDeleting(null);
    },
    onError: (error: Error) =>
      toast({
        title: "Failed to delete contribution rate",
        description: error.message,
        variant: "destructive",
      }),
  });

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };
  const openEdit = (rate: BaoEeContributionRateWithBenefit) => {
    setEditing(rate);
    setForm({
      benefitId: rate.benefitId,
      rate: rate.rate,
      effectiveYmd: rate.effectiveYmd.slice(0, 10),
    });
    setDialogOpen(true);
  };
  const formValid =
    form.benefitId.length > 0 &&
    /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(form.rate.trim()) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveYmd);

  return (
    <Card data-testid="card-bao-ee-contribution-rates">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Employee Contribution Rates</CardTitle>
          <CardDescription className="mt-1 max-w-3xl">
            One flat monthly charge applies once per policy and benefit, regardless of how
            many covered dependents there are. Billing uses the latest rate effective on or
            before the first day of the coverage month; it does not prorate daily. An explicit
            $0.00 means free coverage. No row means the rate is not configured, not free.
          </CardDescription>
        </div>
        {canManage && (
          <Button onClick={openAdd} data-testid="button-add-ee-contribution-rate">
            <Plus className="mr-2 h-4 w-4" />
            Add Rate
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : rates.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground" data-testid="text-no-ee-contribution-rates">
            No employee contribution rates are configured for this policy. This does not mean
            coverage is free; add an explicit $0.00 rate to designate free coverage.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Benefit</TableHead>
                <TableHead>Monthly Contribution</TableHead>
                <TableHead>Effective Date</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((rate) => (
                <TableRow key={rate.id} data-testid={`row-ee-contribution-rate-${rate.id}`}>
                  <TableCell>{rate.benefitName ?? "—"}</TableCell>
                  <TableCell data-testid={`text-ee-contribution-rate-${rate.id}`}>
                    {Number(rate.rate) === 0 ? "Free ($0.00)" : `$${formatRate(rate.rate)}`}
                  </TableCell>
                  <TableCell>{formatYmd(rate.effectiveYmd)}</TableCell>
                  {canManage && (
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(rate)}
                        data-testid={`button-edit-ee-contribution-rate-${rate.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(rate)}
                        data-testid={`button-delete-ee-contribution-rate-${rate.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

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
            <DialogTitle>{editing ? "Edit Contribution Rate" : "Add Contribution Rate"}</DialogTitle>
            <DialogDescription>
              This is the flat monthly amount for this policy and benefit. Enter $0.00 only
              when coverage is explicitly free; a missing rate remains unconfigured.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Benefit</Label>
              <Select
                value={form.benefitId}
                onValueChange={(benefitId) => setForm((current) => ({ ...current, benefitId }))}
              >
                <SelectTrigger data-testid="select-ee-contribution-benefit">
                  <SelectValue placeholder="Select a benefit" />
                </SelectTrigger>
                <SelectContent>
                  {benefits.map((benefit) => (
                    <SelectItem key={benefit.id} value={benefit.id}>
                      {benefit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Monthly Contribution ($)</Label>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                value={form.rate}
                onChange={(event) =>
                  setForm((current) => ({ ...current, rate: event.target.value }))
                }
                data-testid="input-ee-contribution-rate"
              />
              <p className="text-xs text-muted-foreground">
                Use a nonnegative amount with up to two decimal places.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={form.effectiveYmd}
                onChange={(event) =>
                  setForm((current) => ({ ...current, effectiveYmd: event.target.value }))
                }
                data-testid="input-ee-contribution-effective"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!formValid || saveMutation.isPending}
              data-testid="button-save-ee-contribution-rate"
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contribution rate?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the rate for {deleting?.benefitName ?? "this benefit"} effective{" "}
              {deleting ? formatYmd(deleting.effectiveYmd) : "—"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
              data-testid="button-confirm-delete-ee-contribution-rate"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}