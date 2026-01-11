import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

interface WorkerWs {
  id: string;
  name: string;
  description: string | null;
  sequence: number;
}

export default function WorkerWorkStatusesPage() {
  usePageTitle("Work Statuses");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  
  const { data: statuses = [], isLoading } = useQuery<WorkerWs[]>({
    queryKey: ["/api/options/worker-ws"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string | null }) => {
      // Find the highest sequence number
      const maxSequence = statuses.reduce((max, status) => Math.max(max, status.sequence), -1);
      return apiRequest("POST", "/api/options/worker-ws", { 
        ...data, 
        sequence: maxSequence + 1 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/worker-ws"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Worker work status created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create worker work status.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description: string | null }) => {
      return apiRequest("PUT", `/api/options/worker-ws/${data.id}`, {
        name: data.name,
        description: data.description,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/worker-ws"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Worker work status updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update worker work status.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/options/worker-ws/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/worker-ws"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Worker work status deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete worker work status.",
        variant: "destructive",
      });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: { id: string; sequence: number }) => {
      return apiRequest("PUT", `/api/options/worker-ws/${data.id}`, {
        sequence: data.sequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/worker-ws"] });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
  };

  const handleEdit = (status: WorkerWs) => {
    setEditingId(status.id);
    setFormName(status.name);
    setFormDescription(status.description || "");
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
    updateMutation.mutate({
      id: editingId!,
      name: formName.trim(),
      description: formDescription.trim() || null,
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
    createMutation.mutate({
      name: formName.trim(),
      description: formDescription.trim() || null,
    });
  };

  const moveUp = (status: WorkerWs) => {
    const currentIndex = statuses.findIndex(s => s.id === status.id);
    if (currentIndex > 0) {
      const prevStatus = statuses[currentIndex - 1];
      updateSequenceMutation.mutate({ id: status.id, sequence: prevStatus.sequence });
      updateSequenceMutation.mutate({ id: prevStatus.id, sequence: status.sequence });
    }
  };

  const moveDown = (status: WorkerWs) => {
    const currentIndex = statuses.findIndex(s => s.id === status.id);
    if (currentIndex < statuses.length - 1) {
      const nextStatus = statuses[currentIndex + 1];
      updateSequenceMutation.mutate({ id: status.id, sequence: nextStatus.sequence });
      updateSequenceMutation.mutate({ id: nextStatus.id, sequence: status.sequence });
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
        <h1 className="text-3xl font-bold" data-testid="heading-worker-work-statuses">
          Worker Work Statuses
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-status">
          <Plus className="mr-2 h-4 w-4" />
          Add Work Status
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Worker Work Status Management</CardTitle>
          <CardDescription>
            Manage worker work status options for categorizing employment status. Use the arrows to reorder statuses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statuses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-statuses">
              No worker work statuses configured yet. Click "Add Work Status" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Name</TableHead>
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
            <DialogTitle>Add Worker Work Status</DialogTitle>
            <DialogDescription>
              Create a new worker work status option.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Active, Inactive"
                data-testid="input-add-name"
              />
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
                Optional: Provide additional details about this work status.
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
            <DialogTitle>Delete Worker Work Status</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this worker work status? This action cannot be undone.
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
