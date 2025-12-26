import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X, ArrowUp, ArrowDown } from "lucide-react";
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
import { EmploymentStatus } from "@/lib/entity-types";

export default function EmploymentStatusesPage() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formEmployed, setFormEmployed] = useState(false);
  const [formDescription, setFormDescription] = useState("");
  const [formColor, setFormColor] = useState("#6b7280");
  
  const { data: statuses = [], isLoading } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/employment-statuses"],
  });

  const createMutation = useMutation({
    mutationFn: async (formData: { name: string; code: string; employed: boolean; description: string | null; color: string }) => {
      // Find the highest sequence number
      const maxSequence = statuses.reduce((max, status) => Math.max(max, status.sequence ?? 0), -1);
      return apiRequest("POST", "/api/employment-statuses", { 
        name: formData.name,
        code: formData.code,
        employed: formData.employed,
        description: formData.description,
        sequence: maxSequence + 1,
        data: { color: formData.color }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-statuses"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Employment status created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create employment status.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (formData: { id: string; name: string; code: string; employed: boolean; description: string | null; color: string }) => {
      return apiRequest("PUT", `/api/employment-statuses/${formData.id}`, {
        name: formData.name,
        code: formData.code,
        employed: formData.employed,
        description: formData.description,
        data: { color: formData.color }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-statuses"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Employment status updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update employment status.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/employment-statuses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-statuses"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Employment status deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employment status.",
        variant: "destructive",
      });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: { id: string; sequence: number }) => {
      return apiRequest("PUT", `/api/employment-statuses/${data.id}`, {
        sequence: data.sequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-statuses"] });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormCode("");
    setFormEmployed(false);
    setFormDescription("");
    setFormColor("#6b7280");
  };

  const handleEdit = (status: EmploymentStatus) => {
    setEditingId(status.id);
    setFormName(status.name);
    setFormCode(status.code);
    setFormEmployed(status.employed ?? false);
    setFormDescription(status.description || "");
    setFormColor(status.data?.color || "#6b7280");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    resetForm();
  };

  const handleSaveEdit = () => {
    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }
    if (!formCode.trim()) {
      toast({
        title: "Validation Error",
        description: "Code is required.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({
      id: editingId!,
      name: formName.trim(),
      code: formCode.trim(),
      employed: formEmployed,
      description: formDescription.trim() || null,
      color: formColor,
    });
  };

  const handleCreate = () => {
    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }
    if (!formCode.trim()) {
      toast({
        title: "Validation Error",
        description: "Code is required.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: formName.trim(),
      code: formCode.trim(),
      employed: formEmployed,
      description: formDescription.trim() || null,
      color: formColor,
    });
  };

  const moveUp = (status: EmploymentStatus) => {
    const currentIndex = statuses.findIndex(s => s.id === status.id);
    if (currentIndex > 0) {
      const prevStatus = statuses[currentIndex - 1];
      updateSequenceMutation.mutate({ id: status.id, sequence: prevStatus.sequence ?? 0 });
      updateSequenceMutation.mutate({ id: prevStatus.id, sequence: status.sequence ?? 0 });
    }
  };

  const moveDown = (status: EmploymentStatus) => {
    const currentIndex = statuses.findIndex(s => s.id === status.id);
    if (currentIndex < statuses.length - 1) {
      const nextStatus = statuses[currentIndex + 1];
      updateSequenceMutation.mutate({ id: status.id, sequence: nextStatus.sequence ?? 0 });
      updateSequenceMutation.mutate({ id: nextStatus.id, sequence: status.sequence ?? 0 });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold" data-testid="heading-employment-statuses">
          Employment Statuses
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-status">
          <Plus className="mr-2 h-4 w-4" />
          Add Employment Status
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Employment Status Management</CardTitle>
          <CardDescription>
            Manage employment status options for categorizing employment relationships. Use the arrows to reorder statuses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statuses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-statuses">
              No employment statuses configured yet. Click "Add Employment Status" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Employed</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((status, index) => (
                  <TableRow key={status.id} data-testid={`row-status-${status.id}`}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveUp(status)}
                          disabled={index === 0}
                          data-testid={`button-move-up-${status.id}`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveDown(status)}
                          disabled={index === statuses.length - 1}
                          data-testid={`button-move-down-${status.id}`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-color-${status.id}`}>
                      {editingId === status.id ? (
                        <input
                          type="color"
                          value={formColor}
                          onChange={(e) => setFormColor(e.target.value)}
                          className="w-10 h-8 cursor-pointer rounded border border-input"
                          data-testid={`input-edit-color-${status.id}`}
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full border border-border"
                          style={{ backgroundColor: status.data?.color || "#6b7280" }}
                          title={status.data?.color || "No color set"}
                        />
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-name-${status.id}`}>
                      {editingId === status.id ? (
                        <Input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder="Name"
                          data-testid={`input-edit-name-${status.id}`}
                        />
                      ) : (
                        status.name
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-code-${status.id}`}>
                      {editingId === status.id ? (
                        <Input
                          value={formCode}
                          onChange={(e) => setFormCode(e.target.value)}
                          placeholder="Code"
                          data-testid={`input-edit-code-${status.id}`}
                        />
                      ) : (
                        status.code
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-employed-${status.id}`}>
                      {editingId === status.id ? (
                        <Checkbox
                          checked={formEmployed}
                          onCheckedChange={(checked) => setFormEmployed(checked as boolean)}
                          data-testid={`checkbox-edit-employed-${status.id}`}
                        />
                      ) : (
                        <span className={status.employed ? "text-green-600 font-medium" : "text-muted-foreground"}>
                          {status.employed ? "Yes" : "No"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-description-${status.id}`}>
                      {editingId === status.id ? (
                        <Textarea
                          value={formDescription}
                          onChange={(e) => setFormDescription(e.target.value)}
                          placeholder="Description (optional)"
                          rows={2}
                          data-testid={`input-edit-description-${status.id}`}
                        />
                      ) : (
                        status.description ? (
                          <span className="text-sm">{status.description}</span>
                        ) : (
                          <span className="text-muted-foreground italic">None</span>
                        )
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === status.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${status.id}`}
                          >
                            {updateMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCancelEdit}
                            data-testid={`button-cancel-edit-${status.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(status)}
                            data-testid={`button-edit-${status.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(status.id)}
                            data-testid={`button-delete-${status.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent data-testid="dialog-add-status">
          <DialogHeader>
            <DialogTitle>Add Employment Status</DialogTitle>
            <DialogDescription>
              Create a new employment status option.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Full-time, Part-time"
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-code">Code</Label>
              <Input
                id="add-code"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="e.g., FT, PT"
                data-testid="input-add-code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-color">Color</Label>
              <div className="flex items-center gap-3">
                <input
                  id="add-color"
                  type="color"
                  value={formColor}
                  onChange={(e) => setFormColor(e.target.value)}
                  className="w-12 h-10 cursor-pointer rounded border border-input"
                  data-testid="input-add-color"
                />
                <span className="text-sm text-muted-foreground">{formColor}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose a color to visually identify this status on worker lists.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="add-employed"
                checked={formEmployed}
                onCheckedChange={(checked) => setFormEmployed(checked as boolean)}
                data-testid="checkbox-add-employed"
              />
              <Label htmlFor="add-employed" className="cursor-pointer">
                Employed (indicates active employment)
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <Textarea
                id="add-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
                data-testid="input-add-description"
              />
              <p className="text-xs text-muted-foreground">
                Optional: Provide additional details about this employment status.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                resetForm();
              }}
              data-testid="button-cancel-add"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              data-testid="button-submit-add"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Employment Status</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this employment status? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteId(null)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
