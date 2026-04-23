import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Loader2, Layers, CalendarClock } from "lucide-react";

interface AccrualTier {
  id: string;
  year: number;
  minHours: string;
  accrualPct: string;
  data: Record<string, any> | null;
}

const ALL_TIERS_KEY = ["/api/sitespecific/gbhet/pension/accrual-tiers"];

export default function PensionAccrualTiersPage() {
  usePageTitle("Pension Accrual Tiers");
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<AccrualTier | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newGroupDialogOpen, setNewGroupDialogOpen] = useState(false);
  const [newGroupYear, setNewGroupYear] = useState("");

  const [formData, setFormData] = useState({
    year: 0,
    minHours: "",
    accrualPct: "",
  });

  const { data: allTiers = [], isLoading } = useQuery<AccrualTier[]>({
    queryKey: ALL_TIERS_KEY,
  });

  const grouped = allTiers.reduce<Record<number, AccrualTier[]>>((acc, tier) => {
    if (!acc[tier.year]) acc[tier.year] = [];
    acc[tier.year].push(tier);
    return acc;
  }, {});

  const sortedYears = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => b - a);

  for (const year of sortedYears) {
    grouped[year].sort((a, b) => parseFloat(a.minHours) - parseFloat(b.minHours));
  }

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", "/api/sitespecific/gbhet/pension/accrual-tiers", {
        year: data.year,
        minHours: data.minHours,
        accrualPct: data.accrualPct,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_TIERS_KEY });
      setDialogOpen(false);
      toast({ title: "Accrual tier created" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create tier", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      return apiRequest("PATCH", `/api/sitespecific/gbhet/pension/accrual-tiers/${id}`, {
        year: data.year,
        minHours: data.minHours,
        accrualPct: data.accrualPct,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_TIERS_KEY });
      setDialogOpen(false);
      setEditingTier(null);
      toast({ title: "Accrual tier updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update tier", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/gbhet/pension/accrual-tiers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALL_TIERS_KEY });
      setDeleteConfirmId(null);
      toast({ title: "Accrual tier deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete tier", description: error.message, variant: "destructive" });
    },
  });

  const openCreateForYear = (year: number) => {
    setEditingTier(null);
    setFormData({ year, minHours: "", accrualPct: "" });
    setDialogOpen(true);
  };

  const openEdit = (tier: AccrualTier) => {
    setEditingTier(tier);
    setFormData({
      year: tier.year,
      minHours: tier.minHours,
      accrualPct: tier.accrualPct,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTier) {
      updateMutation.mutate({ id: editingTier.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const yearNum = parseInt(newGroupYear);
    if (!yearNum || yearNum < 1900 || yearNum > 2100) {
      toast({ title: "Please enter a valid year between 1900 and 2100", variant: "destructive" });
      return;
    }
    if (grouped[yearNum]) {
      toast({ title: `A tier set effective from ${yearNum} already exists`, variant: "destructive" });
      return;
    }
    setNewGroupDialogOpen(false);
    setNewGroupYear("");
    openCreateForYear(yearNum);
  };

  const formatEffectiveLabel = (year: number, index: number) => {
    const nextYear = sortedYears[index - 1];
    if (year <= 1900) {
      return nextYear ? `Through ${nextYear - 1}` : "All years";
    }
    if (index === 0) {
      return `${year} onward`;
    }
    return nextYear ? `${year} through ${nextYear - 1}` : `${year} onward`;
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12" data-testid="loading-tiers">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-page-title">
            <Layers className="h-5 w-5" />
            Pension Accrual Tiers
          </h2>
          <p className="text-sm text-muted-foreground">
            Hours-to-percentage tiers grouped by effective date. Each set applies from its start year until the next set takes over.
          </p>
        </div>
        <Button onClick={() => setNewGroupDialogOpen(true)} data-testid="button-add-tier-set">
          <Plus className="h-4 w-4 mr-2" />
          New Tier Set
        </Button>
      </div>

      {sortedYears.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No accrual tier sets configured yet. Click "New Tier Set" to create the first set of tiers.
          </CardContent>
        </Card>
      ) : (
        sortedYears.map((year, idx) => (
          <Card key={year} data-testid={`card-tier-set-${year}`}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <div className="flex items-center gap-3 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  Effective from {year <= 1900 ? "the start" : year}
                </CardTitle>
                <Badge variant="secondary">
                  {formatEffectiveLabel(year, sortedYears.indexOf(year))}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openCreateForYear(year)}
                data-testid={`button-add-tier-${year}`}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Tier
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Min Hours</TableHead>
                    <TableHead className="text-right">Accrual Rate</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped[year].map((tier) => (
                    <TableRow key={tier.id} data-testid={`row-tier-${tier.id}`}>
                      <TableCell className="font-medium" data-testid={`text-min-hours-${tier.id}`}>
                        {parseFloat(tier.minHours).toLocaleString()} hrs
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-accrual-pct-${tier.id}`}>
                        {parseFloat(tier.accrualPct).toFixed(2)}%
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(tier)}
                            data-testid={`button-edit-tier-${tier.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteConfirmId(tier.id)}
                            data-testid={`button-delete-tier-${tier.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                {editingTier ? "Edit Accrual Tier" : "Add Accrual Tier"}
              </div>
            </DialogTitle>
            <DialogDescription>
              Effective from {formData.year <= 1900 ? "the start" : formData.year}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {editingTier && sortedYears.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="tierYear">Tier Set</Label>
                <Select
                  value={String(formData.year)}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, year: parseInt(v) }))}
                >
                  <SelectTrigger data-testid="select-tier-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedYears.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        Effective from {y <= 1900 ? "the start" : y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="minHours">Min Hours</Label>
              <Input
                id="minHours"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 500"
                value={formData.minHours}
                onChange={(e) => setFormData(prev => ({ ...prev, minHours: e.target.value }))}
                required
                data-testid="input-min-hours"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accrualPct">Accrual Rate (%)</Label>
              <Input
                id="accrualPct"
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="e.g. 100.00"
                value={formData.accrualPct}
                onChange={(e) => setFormData(prev => ({ ...prev, accrualPct: e.target.value }))}
                required
                data-testid="input-accrual-pct"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-tier">
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingTier ? "Save Changes" : "Create Tier"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={newGroupDialogOpen} onOpenChange={setNewGroupDialogOpen}>
        <DialogContent className="sm:max-w-[350px]">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5" />
                New Tier Set
              </div>
            </DialogTitle>
            <DialogDescription>
              Enter the year this new set of tiers takes effect.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateGroup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newGroupYear">Effective From Year</Label>
              <Input
                id="newGroupYear"
                type="number"
                min={1900}
                max={2100}
                placeholder="e.g. 2025"
                value={newGroupYear}
                onChange={(e) => setNewGroupYear(e.target.value)}
                required
                data-testid="input-new-group-year"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewGroupDialogOpen(false)} data-testid="button-cancel-new-group">
                Cancel
              </Button>
              <Button type="submit" data-testid="button-create-group">
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Accrual Tier</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this accrual tier? This action cannot be undone.
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
    </div>
  );
}
