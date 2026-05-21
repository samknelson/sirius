import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Building2, Loader2 } from "lucide-react";

interface EmployerPlan {
  id: string;
  employerId: string;
  plan: string;
  employerName: string;
  data: Record<string, any> | null;
}

interface Employer {
  id: string;
  name: string;
  isActive: boolean;
}

const API_BASE = "/api/sitespecific/gbhet/pension/employer-plans";

export default function PensionEmployerPlansPage() {
  usePageTitle("Employer Pension Plans");
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    employerId: "",
    plan: "A",
  });

  const { data: employerPlans = [], isLoading } = useQuery<EmployerPlan[]>({
    queryKey: [API_BASE],
  });

  const { data: allEmployers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const assignedEmployerIds = new Set(employerPlans.map(ep => ep.employerId));
  const availableEmployers = allEmployers.filter(e => !assignedEmployerIds.has(e.id) || (editingId && employerPlans.find(ep => ep.id === editingId)?.employerId === e.id));

  const upsertMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", API_BASE, {
        employerId: data.employerId,
        plan: data.plan,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDialogOpen(false);
      setEditingId(null);
      toast({ title: editingId ? "Employer plan updated" : "Employer plan assigned" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save employer plan", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `${API_BASE}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDeleteConfirmId(null);
      toast({ title: "Employer plan removed" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to remove employer plan", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setFormData({ employerId: "", plan: "A" });
    setDialogOpen(true);
  };

  const openEdit = (ep: EmployerPlan) => {
    setEditingId(ep.id);
    setFormData({ employerId: ep.employerId, plan: ep.plan });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employerId) {
      toast({ title: "Please select an employer", variant: "destructive" });
      return;
    }
    upsertMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12" data-testid="loading-employer-plans">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" data-testid="text-page-title">Employer Pension Plan Assignments</h2>
          <p className="text-sm text-muted-foreground">
            Assign each employer to Pension Plan A or Plan B. This determines which accrual tier schedule applies to their workers.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-employer-plan">
          <Plus className="h-4 w-4 mr-2" />
          Assign Employer
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employer</TableHead>
                <TableHead>Pension Plan</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employerPlans.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No employer plan assignments yet. Click "Assign Employer" to get started.
                  </TableCell>
                </TableRow>
              ) : (
                employerPlans.map((ep) => (
                  <TableRow key={ep.id} data-testid={`row-employer-plan-${ep.employerId}`}>
                    <TableCell className="font-medium" data-testid={`text-employer-name-${ep.employerId}`}>
                      {ep.employerName}
                    </TableCell>
                    <TableCell data-testid={`text-employer-plan-${ep.employerId}`}>
                      <Badge variant={ep.plan === "A" ? "default" : "secondary"}>
                        Plan {ep.plan}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(ep)} data-testid={`button-edit-employer-plan-${ep.employerId}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteConfirmId(ep.id)} data-testid={`button-delete-employer-plan-${ep.employerId}`}>
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
                <Building2 className="h-5 w-5" />
                {editingId ? "Edit Plan Assignment" : "Assign Employer to Plan"}
              </div>
            </DialogTitle>
            <DialogDescription>
              Select an employer and assign them to Pension Plan A or B.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="employerId">Employer</Label>
              <Select
                value={formData.employerId}
                onValueChange={(value) => setFormData(prev => ({ ...prev, employerId: value }))}
                disabled={!!editingId}
              >
                <SelectTrigger data-testid="select-employer">
                  <SelectValue placeholder="Select an employer..." />
                </SelectTrigger>
                <SelectContent>
                  {availableEmployers.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="plan">Pension Plan</Label>
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={upsertMutation.isPending} data-testid="button-save-employer-plan">
                {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? "Save Changes" : "Assign"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Plan Assignment</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this employer's pension plan assignment? This action cannot be undone.
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
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
