import { useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Plus, Pencil, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  BaoEmployerRateWithSource,
  BaoRateSourceWithDetails,
  BaoRateSourceType,
} from "@shared/schema/sitespecific/bao/schema";

interface LedgerAccount {
  id: string;
  name: string;
  isActive: boolean;
}

const ALL = "__all__";

const TYPE_LABELS: Record<BaoRateSourceType, string> = {
  contract: "Contract",
  rate_letter: "Rate Letter",
};

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
    maximumFractionDigits: 4,
  });
}

export default function BaoRateSourceRatesPage() {
  const { id: sourceId = "" } = useParams<{ id: string }>();
  const { toast } = useToast();

  // Filters
  const [filterEmployerId, setFilterEmployerId] = useState<string>(ALL);
  const [filterAccountId, setFilterAccountId] = useState<string>(ALL);

  // Bulk editor dialog
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEmployerIds, setBulkEmployerIds] = useState<Set<string>>(new Set());
  const [bulkEffectiveYmd, setBulkEffectiveYmd] = useState("");
  const [bulkRates, setBulkRates] = useState<{ accountId: string; rate: string }[]>([
    { accountId: "", rate: "" },
  ]);

  // Single-entry edit / delete
  const [editing, setEditing] = useState<BaoEmployerRateWithSource | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editYmd, setEditYmd] = useState("");
  const [deleting, setDeleting] = useState<BaoEmployerRateWithSource | null>(null);

  const {
    data: source,
    isLoading: sourceLoading,
    error: sourceError,
  } = useQuery<BaoRateSourceWithDetails>({
    queryKey: ["/api/sitespecific/bao/rate-sources", sourceId],
    enabled: !!sourceId,
    queryFn: async () => {
      const res = await fetch(`/api/sitespecific/bao/rate-sources/${sourceId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to load rate source");
      }
      return res.json();
    },
  });

  usePageTitle(source ? `Rates — ${source.name}` : "Rate Source Rates");

  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const sourceEmployers = source?.employers ?? [];
  const employerById = useMemo(
    () => new Map(sourceEmployers.map((e) => [e.id, e.name])),
    [sourceEmployers],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  const listParams = new URLSearchParams();
  listParams.set("mode", "history");
  listParams.set("sourceId", sourceId);
  if (filterEmployerId !== ALL) listParams.set("employerId", filterEmployerId);
  if (filterAccountId !== ALL) listParams.set("accountId", filterAccountId);

  const ratesKey = ["/api/sitespecific/bao/employer-rates", listParams.toString()] as const;

  const {
    data: rates = [],
    isLoading,
    error,
  } = useQuery<BaoEmployerRateWithSource[]>({
    queryKey: ratesKey,
    enabled: !!sourceId,
    queryFn: async () => {
      const res = await fetch(`/api/sitespecific/bao/employer-rates?${listParams.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to load rates");
      }
      return res.json();
    },
  });

  const invalidateRates = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/employer-rates"] });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sitespecific/bao/employer-rates/bulk", {
        employerIds: Array.from(bulkEmployerIds),
        effectiveYmd: bulkEffectiveYmd,
        sourceId,
        rates: bulkRates
          .filter((r) => r.accountId)
          .map((r) => ({ accountId: r.accountId, rate: Number(r.rate) })),
      });
    },
    onSuccess: async () => {
      await invalidateRates();
      toast({ title: "Rates saved", description: "Rate entries were created/updated." });
      setBulkOpen(false);
      setBulkEmployerIds(new Set());
      setBulkEffectiveYmd("");
      setBulkRates([{ accountId: "", rate: "" }]);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      return apiRequest("PATCH", `/api/sitespecific/bao/employer-rates/${editing.id}`, {
        rate: Number(editRate),
        effectiveYmd: editYmd,
        sourceId,
      });
    },
    onSuccess: async () => {
      await invalidateRates();
      toast({ title: "Rate updated" });
      setEditing(null);
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/bao/employer-rates/${id}`);
    },
    onSuccess: async () => {
      await invalidateRates();
      toast({ title: "Rate deleted" });
      setDeleting(null);
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const groupedRates = useMemo(() => {
    const groups = new Map<string, BaoEmployerRateWithSource[]>();
    for (const r of rates) {
      const existing = groups.get(r.employerId);
      if (existing) existing.push(r);
      else groups.set(r.employerId, [r]);
    }
    const result = Array.from(groups.entries()).map(([employerId, entries]) => ({
      employerId,
      employerName: employerById.get(employerId) ?? employerId,
      entries: entries.slice().sort((a, b) => {
        const fundA = accountById.get(a.accountId) ?? a.accountId;
        const fundB = accountById.get(b.accountId) ?? b.accountId;
        const byFund = fundA.localeCompare(fundB);
        if (byFund !== 0) return byFund;
        return (b.effectiveYmd ?? "").localeCompare(a.effectiveYmd ?? "");
      }),
    }));
    result.sort((a, b) => a.employerName.localeCompare(b.employerName));
    return result;
  }, [rates, employerById, accountById]);

  const bulkValid =
    bulkEmployerIds.size > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(bulkEffectiveYmd) &&
    bulkRates.some((r) => r.accountId) &&
    bulkRates
      .filter((r) => r.accountId)
      .every((r) => r.rate.trim() !== "" && Number.isFinite(Number(r.rate)) && Number(r.rate) >= 0) &&
    new Set(bulkRates.filter((r) => r.accountId).map((r) => r.accountId)).size ===
      bulkRates.filter((r) => r.accountId).length;

  const toggleBulkEmployer = (id: string, checked: boolean) => {
    setBulkEmployerIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  if (sourceLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sourceError || !source) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild data-testid="button-back-to-sources">
          <Link href="/config/sitespecific/bao/rate-sources">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Rate Sources
          </Link>
        </Button>
        <p className="text-center py-8 text-destructive" data-testid="text-source-error">
          {(sourceError as Error | null)?.message || "Rate source not found."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="mb-2 -ml-2"
          data-testid="button-back-to-sources"
        >
          <Link href="/config/sitespecific/bao/rate-sources">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Rate Sources
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold" data-testid="title-source-rates">
                {source.name}
              </h1>
              <Badge variant="outline">{TYPE_LABELS[source.type] ?? source.type}</Badge>
              {source.isActive ? (
                <Badge>Active</Badge>
              ) : (
                <Badge variant="secondary">Superseded</Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              Rates documented by this source (starts {formatYmd(source.startYmd)}). New entries
              are limited to the source's employers.
            </p>
          </div>
          <Button onClick={() => setBulkOpen(true)} data-testid="button-open-bulk-editor">
            <Plus className="h-4 w-4 mr-2" />
            Add / Update Rates
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-sm">Employer</Label>
              <Select value={filterEmployerId} onValueChange={setFilterEmployerId}>
                <SelectTrigger data-testid="select-filter-employer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All employers</SelectItem>
                  {sourceEmployers.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Fund (Account)</Label>
              <Select value={filterAccountId} onValueChange={setFilterAccountId}>
                <SelectTrigger data-testid="select-filter-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All funds</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rates</CardTitle>
          <CardDescription>All rate entries attached to this source.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-center py-8 text-destructive" data-testid="text-rates-error">
              {(error as Error).message}
            </p>
          ) : rates.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-no-rates">
              No rate entries for this source yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fund (Account)</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedRates.map((group) => [
                  <TableRow
                    key={`employer-${group.employerId}`}
                    className="bg-muted/50 hover:bg-muted/50"
                    data-testid={`row-employer-group-${group.employerId}`}
                  >
                    <TableCell colSpan={5} className="font-semibold">
                      <span data-testid={`text-group-employer-${group.employerId}`}>
                        {group.employerName}
                      </span>
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}
                      </span>
                    </TableCell>
                  </TableRow>,
                  ...group.entries.map((r) => (
                  <TableRow key={r.id} data-testid={`row-rate-${r.id}`}>
                    <TableCell className="pl-8" data-testid={`text-rate-account-${r.id}`}>
                      {accountById.get(r.accountId) ?? r.accountId}
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-rate-value-${r.id}`}>
                      ${formatRate(r.rate)}
                    </TableCell>
                    <TableCell data-testid={`text-rate-effective-${r.id}`}>
                      {formatYmd(r.effectiveYmd)}
                    </TableCell>
                    <TableCell data-testid={`status-rate-${r.id}`}>
                      {r.isActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditing(r);
                            setEditRate(r.rate);
                            setEditYmd(r.effectiveYmd?.slice(0, 10) ?? "");
                          }}
                          data-testid={`button-edit-rate-${r.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(r)}
                          data-testid={`button-delete-rate-${r.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  )),
                ])}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bulk editor */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add / Update Rates for {source.name}</DialogTitle>
            <DialogDescription>
              Apply an effective-dated rate per fund account to this source's employers. Existing
              entries with the same employer, fund, and effective date are updated.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div>
              <Label className="text-sm font-medium">
                Employers ({bulkEmployerIds.size} selected)
              </Label>
              <div className="border rounded-md max-h-48 overflow-y-auto p-2 space-y-1 mt-1">
                {sourceEmployers.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-2">
                    This source has no employers.
                  </p>
                ) : (
                  sourceEmployers.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-center gap-2 p-1 rounded hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={bulkEmployerIds.has(e.id)}
                        onCheckedChange={(checked) => toggleBulkEmployer(e.id, checked === true)}
                        data-testid={`checkbox-bulk-employer-${e.id}`}
                      />
                      <span className="text-sm">{e.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Effective Date</Label>
              <Input
                type="date"
                value={bulkEffectiveYmd}
                onChange={(e) => setBulkEffectiveYmd(e.target.value)}
                className="mt-1 max-w-xs"
                data-testid="input-bulk-effective"
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Rates per Fund Account</Label>
              <div className="space-y-2 mt-1">
                {bulkRates.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={row.accountId}
                      onValueChange={(v) =>
                        setBulkRates((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, accountId: v } : r)),
                        )
                      }
                    >
                      <SelectTrigger className="flex-1" data-testid={`select-bulk-account-${i}`}>
                        <SelectValue placeholder="Select fund account…" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      placeholder="Hourly rate"
                      value={row.rate}
                      onChange={(e) =>
                        setBulkRates((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, rate: e.target.value } : r)),
                        )
                      }
                      className="w-36"
                      data-testid={`input-bulk-rate-${i}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setBulkRates((prev) => prev.filter((_, j) => j !== i))}
                      disabled={bulkRates.length === 1}
                      data-testid={`button-remove-bulk-rate-${i}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkRates((prev) => [...prev, { accountId: "", rate: "" }])}
                  data-testid="button-add-bulk-rate"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Fund
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} data-testid="button-cancel-bulk">
              Cancel
            </Button>
            <Button
              onClick={() => bulkMutation.mutate()}
              disabled={!bulkValid || bulkMutation.isPending}
              data-testid="button-save-bulk"
            >
              {bulkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Rates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit single entry */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Rate Entry</DialogTitle>
            <DialogDescription>
              {editing && (
                <>
                  {employerById.get(editing.employerId) ?? editing.employerId} —{" "}
                  {accountById.get(editing.accountId) ?? editing.accountId} (source: {source.name})
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Rate</Label>
              <Input
                type="number"
                step="0.0001"
                min="0"
                value={editRate}
                onChange={(e) => setEditRate(e.target.value)}
                data-testid="input-edit-rate"
              />
            </div>
            <div>
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={editYmd}
                onChange={(e) => setEditYmd(e.target.value)}
                data-testid="input-edit-effective"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={
                updateMutation.isPending ||
                editRate.trim() === "" ||
                !Number.isFinite(Number(editRate)) ||
                Number(editRate) < 0 ||
                !/^\d{4}-\d{2}-\d{2}$/.test(editYmd)
              }
              data-testid="button-save-edit"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Rate Entry</DialogTitle>
            <DialogDescription>
              Delete the rate for{" "}
              {deleting && (employerById.get(deleting.employerId) ?? deleting.employerId)} —{" "}
              {deleting && (accountById.get(deleting.accountId) ?? deleting.accountId)} effective{" "}
              {deleting && formatYmd(deleting.effectiveYmd)}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
