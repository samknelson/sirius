import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface WorkerIdType {
  id: string;
  name: string;
  sequence: number;
  validator: string | null;
}

export default function WorkerIDTypesPage() {
  usePageTitle("Worker ID Types");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formValidator, setFormValidator] = useState("");
  
  const { data: workerIdTypes = [], isLoading } = useQuery<WorkerIdType[]>({
    queryKey: ["/api/worker-id-types"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; validator: string | null }) => {
      // Find the highest sequence number
      const maxSequence = workerIdTypes.reduce((max, type) => Math.max(max, type.sequence), -1);
      return apiRequest("POST", "/api/worker-id-types", { 
        ...data, 
        sequence: maxSequence + 1 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-id-types"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Worker ID type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create worker ID type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; validator: string | null }) => {
      return apiRequest("PUT", `/api/worker-id-types/${data.id}`, {
        name: data.name,
        validator: data.validator,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-id-types"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Worker ID type updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update worker ID type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/worker-id-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-id-types"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Worker ID type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete worker ID type.",
        variant: "destructive",
      });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: { id: string; sequence: number }) => {
      return apiRequest("PUT", `/api/worker-id-types/${data.id}`, {
        sequence: data.sequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-id-types"] });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormValidator("");
  };

  const handleEdit = (type: WorkerIdType) => {
    setEditingId(type.id);
    setFormName(type.name);
    setFormValidator(type.validator || "");
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
      validator: formValidator.trim() || null,
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
      validator: formValidator.trim() || null,
    });
  };

  const moveUp = (type: WorkerIdType) => {
    const currentIndex = workerIdTypes.findIndex(t => t.id === type.id);
    if (currentIndex > 0) {
      const prevType = workerIdTypes[currentIndex - 1];
      updateSequenceMutation.mutate({ id: type.id, sequence: prevType.sequence });
      updateSequenceMutation.mutate({ id: prevType.id, sequence: type.sequence });
    }
  };

  const moveDown = (type: WorkerIdType) => {
    const currentIndex = workerIdTypes.findIndex(t => t.id === type.id);
    if (currentIndex < workerIdTypes.length - 1) {
      const nextType = workerIdTypes[currentIndex + 1];
      updateSequenceMutation.mutate({ id: type.id, sequence: nextType.sequence });
      updateSequenceMutation.mutate({ id: nextType.id, sequence: type.sequence });
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
        <h1 className="text-3xl font-bold" data-testid="heading-worker-id-types">
          Worker ID Types
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-worker-id-type">
          <Plus className="mr-2 h-4 w-4" />
          Add Worker ID Type
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Worker ID Types Management</CardTitle>
          <CardDescription>
            Manage the types of identification numbers that can be assigned to workers. Use the arrows to reorder types.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workerIdTypes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-types">
              No worker ID types configured yet. Click "Add Worker ID Type" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Validator (Regex)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workerIdTypes.map((type, index) => (
                  <TableRow key={type.id} data-testid={`row-worker-id-type-${type.id}`}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveUp(type)}
                          disabled={index === 0}
                          data-testid={`button-move-up-${type.id}`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveDown(type)}
                          disabled={index === workerIdTypes.length - 1}
                          data-testid={`button-move-down-${type.id}`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-name-${type.id}`}>
                      {editingId === type.id ? (
                        <Input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder="Name"
                          data-testid={`input-edit-name-${type.id}`}
                        />
                      ) : (
                        type.name
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-validator-${type.id}`}>
                      {editingId === type.id ? (
                        <Input
                          value={formValidator}
                          onChange={(e) => setFormValidator(e.target.value)}
                          placeholder="Regex pattern (optional)"
                          data-testid={`input-edit-validator-${type.id}`}
                        />
                      ) : (
                        type.validator ? (
                          <code className="text-xs bg-muted px-2 py-1 rounded">{type.validator}</code>
                        ) : (
                          <span className="text-muted-foreground italic">None</span>
                        )
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === type.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${type.id}`}
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
                            data-testid={`button-cancel-edit-${type.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(type)}
                            data-testid={`button-edit-${type.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(type.id)}
                            data-testid={`button-delete-${type.id}`}
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
        <DialogContent data-testid="dialog-add-worker-id-type">
          <DialogHeader>
            <DialogTitle>Add Worker ID Type</DialogTitle>
            <DialogDescription>
              Create a new worker ID type with an optional regex validator.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Employee ID, Badge Number"
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-validator">Validator (Regex Pattern)</Label>
              <Input
                id="add-validator"
                value={formValidator}
                onChange={(e) => setFormValidator(e.target.value)}
                placeholder="e.g., ^[A-Z]{2}\\d{6}$ (optional)"
                data-testid="input-add-validator"
              />
              <p className="text-xs text-muted-foreground">
                Optional: Enter a regular expression to validate IDs of this type.
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
              Add Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Worker ID Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this worker ID type? This action cannot be undone.
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
