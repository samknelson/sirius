import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Edit, Trash2, Loader2, DollarSign } from "lucide-react";

interface BenefitSchedule {
  id: string;
  year: number;
  plan: string;
  monthlyBenefitRate: string;
  data: Record<string, any> | null;
}

const API_BASE = "/api/sitespecific/gbhet/pension/benefit-schedules";

export default function PensionBenefitSchedulesPage() {
  usePageTitle("Pension Benefit Schedules");
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    year: new Date().getFullYear().toString(),
    plan: "A",
    monthlyBenefitRate: "",
  });

  const { data: schedules = [], isLoading } = useQuery<BenefitSchedule[]>({
    queryKey: [API_BASE],
  });

  const sorted = [...schedules].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return a.plan.localeCompare(b.plan);
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", API_BASE, {
        year: parseInt(data.year),
        plan: data.plan,
        monthlyBenefitRate: data.monthlyBenefitRate,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDialogOpen(false);
      toast({ title: "Benefit schedule created" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create schedule", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      return apiRequest("PATCH", `${API_BASE}/${id}`, {
        year: parseInt(data.year),
        plan: data.plan,
        monthlyBenefitRate: data.monthlyBenefitRate,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDialogOpen(false);
      setEditingId(null);
      toast({ title: "Benefit schedule updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update schedule", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `${API_BASE}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDeleteConfirmId(null);
      toast({ title: "Benefit schedule deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete schedule", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setFormData({
      year: new Date().getFullYear().toString(),
      plan: "A",
      monthlyBenefitRate: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (s: BenefitSchedule) => {
    setEditingId(s.id);
    setFormData({
      year: s.year.toString(),
      plan: s.plan,
      monthlyBenefitRate: s.monthlyBenefitRate,
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12" data-testid="loading-benefit-schedules">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-page-title">
            <DollarSign className="h-5 w-5" />
            Pension Benefit Schedules
          </h2>
          <p className="text-sm text-muted-foreground">
            Monthly benefit rates by year and plan for the VDB pension fund.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-schedule">
          <Plus className="h-4 w-4 mr-2" />
          Add Rate
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Monthly Benefit Rate</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No benefit schedules configured yet. Click "Add Rate" to get started.
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((s) => (
                  <TableRow key={s.id} data-testid={`row-schedule-${s.id}`}>
                    <TableCell className="font-medium" data-testid={`text-year-${s.id}`}>
                      {s.year}
                    </TableCell>
                    <TableCell data-testid={`text-plan-${s.id}`}>
                      <Badge variant={s.plan === "A" ? "default" : "secondary"}>
                        Plan {s.plan}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-rate-${s.id}`}>
                      ${parseFloat(s.monthlyBenefitRate).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(s)} data-testid={`button-edit-schedule-${s.id}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteConfirmId(s.id)} data-testid={`button-delete-schedule-${s.id}`}>
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
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {editingId ? "Edit Benefit Rate" : "Add Benefit Rate"}
              </div>
            </DialogTitle>
            <DialogDescription>
              Set the monthly benefit rate for a specific year and plan.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                type="number"
                min={1990}
                max={2100}
                value={formData.year}
                onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
                required
                data-testid="input-year"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="plan">Plan</Label>
              <Select
                value={formData.plan}
                onValueChange={(value) => setFormData(prev => ({ ...prev, plan: value }))}
              >
                <SelectTrigger data-testid="select-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">Plan A</SelectItem>
                  <SelectItem value="B">Plan B</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="monthlyBenefitRate">Monthly Benefit Rate ($)</Label>
              <Input
                id="monthlyBenefitRate"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 300.00"
                value={formData.monthlyBenefitRate}
                onChange={(e) => setFormData(prev => ({ ...prev, monthlyBenefitRate: e.target.value }))}
                required
                data-testid="input-rate"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-schedule">
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? "Save Changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Benefit Rate</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this benefit schedule rate? This action cannot be undone.
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
