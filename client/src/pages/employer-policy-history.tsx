import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Plus, Trash2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import type { Policy } from "@shared/schema";

interface PolicyHistoryEntry {
  id: string;
  date: string;
  employerId: string;
  policyId: string;
  data: any;
  createdAt: string;
  policy: Policy | null;
}

function EmployerPolicyHistoryContent() {
  const { employer } = useEmployerLayout();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PolicyHistoryEntry | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formPolicyId, setFormPolicyId] = useState("");

  const { data: history = [], isLoading } = useQuery<PolicyHistoryEntry[]>({
    queryKey: ["/api/employers", employer.id, "policy-history"],
    queryFn: async () => {
      const response = await fetch(`/api/employers/${employer.id}/policy-history`);
      if (!response.ok) {
        throw new Error("Failed to fetch policy history");
      }
      return response.json();
    },
  });

  const { data: policies = [] } = useQuery<Policy[]>({
    queryKey: ["/api/policies"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { date: string; policyId: string }) => {
      return apiRequest("POST", `/api/employers/${employer.id}/policy-history`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id, "policy-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id] });
      setIsAddDialogOpen(false);
      setFormDate("");
      setFormPolicyId("");
      toast({ title: "Policy history entry created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: getApiErrorMessage(error, "An unexpected error occurred"), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { date?: string; policyId?: string } }) => {
      return apiRequest("PUT", `/api/employers/${employer.id}/policy-history/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id, "policy-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id] });
      setIsEditDialogOpen(false);
      setSelectedEntry(null);
      setFormDate("");
      setFormPolicyId("");
      toast({ title: "Policy history entry updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: getApiErrorMessage(error, "An unexpected error occurred"), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/employers/${employer.id}/policy-history/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id, "policy-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id] });
      setIsDeleteDialogOpen(false);
      setSelectedEntry(null);
      toast({ title: "Policy history entry deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: getApiErrorMessage(error, "An unexpected error occurred"), variant: "destructive" });
    },
  });

  const handleAdd = () => {
    setFormDate("");
    setFormPolicyId("");
    setIsAddDialogOpen(true);
  };

  const handleEdit = (entry: PolicyHistoryEntry) => {
    setSelectedEntry(entry);
    setFormDate(entry.date);
    setFormPolicyId(entry.policyId);
    setIsEditDialogOpen(true);
  };

  const handleDelete = (entry: PolicyHistoryEntry) => {
    setSelectedEntry(entry);
    setIsDeleteDialogOpen(true);
  };

  const handleSubmitAdd = () => {
    if (!formDate || !formPolicyId) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createMutation.mutate({ date: formDate, policyId: formPolicyId });
  };

  const handleSubmitEdit = () => {
    if (!selectedEntry || !formDate || !formPolicyId) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: selectedEntry.id,
      data: { date: formDate, policyId: formPolicyId },
    });
  };

  const handleConfirmDelete = () => {
    if (selectedEntry) {
      deleteMutation.mutate(selectedEntry.id);
    }
  };

  const currentPolicy = history.length > 0 ? history[0] : null;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Policy History
          </CardTitle>
          <Button onClick={handleAdd} data-testid="button-add-policy-history">
            <Plus className="w-4 h-4 mr-2" />
            Add Entry
          </Button>
        </CardHeader>
        <CardContent>
          {currentPolicy && (
            <div className="mb-6 p-4 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Current Policy</div>
              <div className="flex items-center gap-2">
                <Badge data-testid="badge-current-policy">
                  {currentPolicy.policy?.name || "Unknown Policy"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  (effective {format(new Date(currentPolicy.date), "MMM dd, yyyy")})
                </span>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading policy history...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No policy history entries found for this employer.
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Effective Date</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Policy ID</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry, index) => (
                    <TableRow key={entry.id} data-testid={`row-policy-history-${entry.id}`}>
                      <TableCell className="font-medium">
                        {format(new Date(entry.date), "MMM dd, yyyy")}
                        {index === 0 && (
                          <Badge variant="secondary" className="ml-2">Current</Badge>
                        )}
                      </TableCell>
                      <TableCell>{entry.policy?.name || "Unknown"}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {entry.policy?.siriusId || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(entry.createdAt), "MMM dd, yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(entry)}
                            data-testid={`button-edit-${entry.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(entry)}
                            data-testid={`button-delete-${entry.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Policy History Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="add-date">Effective Date</Label>
              <Input
                id="add-date"
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                data-testid="input-add-date"
              />
            </div>
            <div>
              <Label htmlFor="add-policy">Policy</Label>
              <Select value={formPolicyId} onValueChange={setFormPolicyId}>
                <SelectTrigger data-testid="select-add-policy">
                  <SelectValue placeholder="Select a policy" />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name || policy.siriusId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmitAdd} 
              disabled={createMutation.isPending}
              data-testid="button-submit-add"
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Policy History Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-date">Effective Date</Label>
              <Input
                id="edit-date"
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                data-testid="input-edit-date"
              />
            </div>
            <div>
              <Label htmlFor="edit-policy">Policy</Label>
              <Select value={formPolicyId} onValueChange={setFormPolicyId}>
                <SelectTrigger data-testid="select-edit-policy">
                  <SelectValue placeholder="Select a policy" />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name || policy.siriusId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmitEdit} 
              disabled={updateMutation.isPending}
              data-testid="button-submit-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Policy History Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this policy history entry? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function EmployerPolicyHistory() {
  return (
    <EmployerLayout activeTab="policy-history">
      <EmployerPolicyHistoryContent />
    </EmployerLayout>
  );
}
