import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Trash2, Loader2, Pencil } from "lucide-react";

interface ShareValue {
  id: string;
  effectiveDate: string;
  shareValue: string;
  notes: string | null;
}

const API_BASE = "/api/sitespecific/gbhet/pension/share-values";

export default function PensionShareValuesPage() {
  usePageTitle("Pension Share Values");
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const emptyForm = { effectiveDate: new Date().toISOString().slice(0, 10), shareValue: "", notes: "" };
  const [formData, setFormData] = useState(emptyForm);

  const openCreate = () => { setEditingId(null); setFormData(emptyForm); setDialogOpen(true); };
  const openEdit = (sv: ShareValue) => {
    setEditingId(sv.id);
    setFormData({ effectiveDate: sv.effectiveDate, shareValue: sv.shareValue, notes: sv.notes ?? "" });
    setDialogOpen(true);
  };

  const { data: shareValues = [], isLoading } = useQuery<ShareValue[]>({
    queryKey: [API_BASE],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingId) {
        return await apiRequest("PATCH", `${API_BASE}/${editingId}`, data);
      }
      return await apiRequest("POST", API_BASE, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDialogOpen(false);
      setEditingId(null);
      setFormData(emptyForm);
      toast({ title: editingId ? "Share value updated" : "Share value added" });
    },
    onError: (err) => {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `${API_BASE}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_BASE] });
      setDeleteConfirmId(null);
      toast({ title: "Share value deleted" });
    },
  });

  return (
    <div className="container py-6 space-y-4" data-testid="page-share-values">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Pension Share Values</CardTitle>
            <CardDescription>Effective-dated share values for the GBHE Variable Defined Benefit pension</CardDescription>
          </div>
          <Button onClick={openCreate} data-testid="button-add-share-value">
            <Plus className="mr-2 h-4 w-4" /> Add Share Value
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Share Value</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareValues.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No share values yet</TableCell></TableRow>
                ) : shareValues.map((sv) => (
                  <TableRow key={sv.id} data-testid={`row-share-value-${sv.id}`}>
                    <TableCell>{sv.effectiveDate}</TableCell>
                    <TableCell>${Number(sv.shareValue).toFixed(4)}</TableCell>
                    <TableCell className="text-muted-foreground">{sv.notes || ""}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(sv)} data-testid={`button-edit-${sv.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteConfirmId(sv.id)} data-testid={`button-delete-${sv.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit" : "Add"} Share Value</DialogTitle>
            <DialogDescription>Effective-dated share value used for benefit calculations.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="effectiveDate">Effective Date</Label>
              <Input id="effectiveDate" type="date" value={formData.effectiveDate}
                onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })} data-testid="input-effective-date" />
            </div>
            <div>
              <Label htmlFor="shareValue">Share Value</Label>
              <Input id="shareValue" type="number" step="0.0001" value={formData.shareValue}
                onChange={(e) => setFormData({ ...formData, shareValue: e.target.value })} data-testid="input-share-value" />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })} data-testid="input-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isPending} data-testid="button-save-share-value">
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Share Value?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)} data-testid="button-confirm-delete">
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
