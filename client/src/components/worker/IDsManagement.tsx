import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Worker, formatSSN, unformatSSN, validateSSN } from "@shared/schema";
import { Loader2, Save, CreditCard, Plus, Edit, Trash2, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface IDsManagementProps {
  workerId: string;
}

interface WorkerIdType {
  id: string;
  name: string;
  sequence: number;
  validator: string | null;
}

interface WorkerId {
  id: string;
  workerId: string;
  typeId: string;
  value: string;
}

export default function IDsManagement({ workerId }: IDsManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedSSN, setEditedSSN] = useState<string>("");
  const [isEditingSSN, setIsEditingSSN] = useState(false);
  
  // Worker IDs state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formTypeId, setFormTypeId] = useState("");
  const [formValue, setFormValue] = useState("");

  // Fetch worker information
  const { data: worker, isLoading: isLoadingWorker } = useQuery<Worker>({
    queryKey: ["/api/workers", workerId],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${workerId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch worker");
      }
      return response.json();
    },
    enabled: !!workerId,
  });

  // Fetch worker ID types
  const { data: workerIdTypes = [], isLoading: isLoadingTypes } = useQuery<WorkerIdType[]>({
    queryKey: ["/api/worker-id-types"],
  });

  // Fetch worker IDs
  const { data: workerIds = [], isLoading: isLoadingIds } = useQuery<WorkerId[]>({
    queryKey: ["/api/workers", workerId, "ids"],
    enabled: !!workerId,
  });

  // Update SSN mutation
  const updateSSNMutation = useMutation({
    mutationFn: async (ssn: string) => {
      const unformattedSSN = unformatSSN(ssn);
      return apiRequest("PUT", `/api/workers/${workerId}`, { ssn: unformattedSSN });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId] });
      setIsEditingSSN(false);
      toast({
        title: "Success",
        description: "SSN updated successfully!",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to update SSN. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Create worker ID mutation
  const createMutation = useMutation({
    mutationFn: async (data: { typeId: string; value: string }) => {
      return apiRequest("POST", `/api/workers/${workerId}/ids`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId, "ids"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Worker ID created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create worker ID.",
        variant: "destructive",
      });
    },
  });

  // Update worker ID mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; typeId: string; value: string }) => {
      return apiRequest("PUT", `/api/worker-ids/${data.id}`, {
        typeId: data.typeId,
        value: data.value,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId, "ids"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Worker ID updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update worker ID.",
        variant: "destructive",
      });
    },
  });

  // Delete worker ID mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/worker-ids/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId, "ids"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Worker ID deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete worker ID.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormTypeId("");
    setFormValue("");
  };

  const handleEditSSN = () => {
    setEditedSSN(formatSSN(worker?.ssn) || "");
    setIsEditingSSN(true);
  };

  const handleSaveSSN = () => {
    const unformatted = unformatSSN(editedSSN);
    
    if (unformatted.length === 0) {
      updateSSNMutation.mutate("");
      return;
    }
    
    const validation = validateSSN(unformatted);
    if (!validation.valid) {
      toast({
        title: "Invalid SSN",
        description: validation.error,
        variant: "destructive",
      });
      return;
    }
    
    updateSSNMutation.mutate(editedSSN);
  };

  const handleCancelSSN = () => {
    setEditedSSN("");
    setIsEditingSSN(false);
  };

  const handleSSNChange = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 9) {
      let formatted = digits;
      if (digits.length > 3) {
        formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
      }
      if (digits.length > 5) {
        formatted = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
      }
      setEditedSSN(formatted);
    }
  };

  const validateWorkerIdValue = (typeId: string, value: string): { valid: boolean; error?: string } => {
    const type = workerIdTypes.find(t => t.id === typeId);
    if (!type) {
      return { valid: false, error: "Invalid type selected" };
    }
    
    if (!type.validator) {
      return { valid: true };
    }
    
    try {
      const regex = new RegExp(type.validator);
      if (!regex.test(value)) {
        return { 
          valid: false, 
          error: `Value does not match the required format for ${type.name}` 
        };
      }
      return { valid: true };
    } catch (e) {
      // If regex is invalid, allow the value but log the error
      console.error('Invalid regex pattern:', e);
      return { valid: true };
    }
  };

  const handleEdit = (id: WorkerId) => {
    setEditingId(id.id);
    setFormTypeId(id.typeId);
    setFormValue(id.value);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    resetForm();
  };

  const handleSaveEdit = () => {
    if (!formTypeId.trim() || !formValue.trim()) {
      toast({
        title: "Validation Error",
        description: "Type and Value are required.",
        variant: "destructive",
      });
      return;
    }
    
    const validation = validateWorkerIdValue(formTypeId, formValue);
    if (!validation.valid) {
      toast({
        title: "Validation Error",
        description: validation.error || "Invalid value",
        variant: "destructive",
      });
      return;
    }
    
    updateMutation.mutate({
      id: editingId!,
      typeId: formTypeId.trim(),
      value: formValue.trim(),
    });
  };

  const handleCreate = () => {
    if (!formTypeId.trim() || !formValue.trim()) {
      toast({
        title: "Validation Error",
        description: "Type and Value are required.",
        variant: "destructive",
      });
      return;
    }
    
    const validation = validateWorkerIdValue(formTypeId, formValue);
    if (!validation.valid) {
      toast({
        title: "Validation Error",
        description: validation.error || "Invalid value",
        variant: "destructive",
      });
      return;
    }
    
    createMutation.mutate({
      typeId: formTypeId.trim(),
      value: formValue.trim(),
    });
  };

  const getTypeName = (typeId: string) => {
    const type = workerIdTypes.find(t => t.id === typeId);
    return type?.name || "Unknown";
  };

  const getTypeValidator = (typeId: string) => {
    const type = workerIdTypes.find(t => t.id === typeId);
    return type?.validator || null;
  };

  if (isLoadingWorker || isLoadingTypes || isLoadingIds) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Worker IDs</CardTitle>
          <CardDescription>Manage worker identification numbers</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loading-spinner" />
        </CardContent>
      </Card>
    );
  }

  const selectedTypeValidator = getTypeValidator(formTypeId);

  return (
    <div className="space-y-6">
      {/* SSN Section */}
      <Card>
        <CardHeader>
          <CardTitle>Social Security Number</CardTitle>
          <CardDescription>Manage worker's SSN</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isEditingSSN ? (
            <div className="space-y-4">
              <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                  <CreditCard size={20} />
                </div>
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Social Security Number</Label>
                  <p className="text-lg font-semibold text-foreground font-mono" data-testid="text-worker-ssn">
                    {worker?.ssn ? formatSSN(worker.ssn) : "Not set"}
                  </p>
                </div>
                <Button
                  onClick={handleEditSSN}
                  variant="outline"
                  size="sm"
                  data-testid="button-edit-ssn"
                >
                  Edit
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ssn">Social Security Number</Label>
                <Input
                  id="ssn"
                  value={editedSSN}
                  onChange={(e) => handleSSNChange(e.target.value)}
                  placeholder="123-45-6789"
                  maxLength={11}
                  autoFocus
                  data-testid="input-ssn"
                />
                <p className="text-xs text-muted-foreground">Format: XXX-XX-XXXX (9 digits)</p>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={handleCancelSSN}
                  disabled={updateSSNMutation.isPending}
                  data-testid="button-cancel-ssn-edit"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveSSN}
                  disabled={updateSSNMutation.isPending}
                  data-testid="button-save-ssn"
                >
                  {updateSSNMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Worker IDs Section */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Additional IDs</CardTitle>
              <CardDescription>Manage worker identification numbers</CardDescription>
            </div>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-worker-id">
              <Plus className="mr-2 h-4 w-4" />
              Add ID
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {workerIds.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-worker-ids">
              No additional IDs configured yet. Click "Add ID" to create one.
            </div>
          ) : (
            <div className="space-y-4">
              {workerIds.map((id) => (
                <div key={id.id} data-testid={`row-worker-id-${id.id}`}>
                  {editingId === id.id ? (
                    <div className="p-4 bg-muted/30 rounded-lg border border-border space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`edit-type-${id.id}`}>Type</Label>
                          <Select value={formTypeId} onValueChange={setFormTypeId}>
                            <SelectTrigger id={`edit-type-${id.id}`} data-testid={`select-edit-type-${id.id}`}>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              {workerIdTypes.map((type) => (
                                <SelectItem key={type.id} value={type.id} data-testid={`option-edit-type-${type.id}`}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`edit-value-${id.id}`}>Value</Label>
                          <Input
                            id={`edit-value-${id.id}`}
                            value={formValue}
                            onChange={(e) => setFormValue(e.target.value)}
                            placeholder="Enter ID value"
                            data-testid={`input-edit-value-${id.id}`}
                          />
                          {selectedTypeValidator && (
                            <p className="text-xs text-muted-foreground">
                              Pattern: <code>{selectedTypeValidator}</code>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button
                          variant="outline"
                          onClick={handleCancelEdit}
                          disabled={updateMutation.isPending}
                          data-testid={`button-cancel-edit-${id.id}`}
                        >
                          <X className="mr-2 h-4 w-4" />
                          Cancel
                        </Button>
                        <Button
                          onClick={handleSaveEdit}
                          disabled={updateMutation.isPending}
                          data-testid={`button-save-${id.id}`}
                        >
                          {updateMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <Save className="mr-2 h-4 w-4" />
                              Save
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
                      <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                        <CreditCard size={20} />
                      </div>
                      <div className="flex-1">
                        <Label className="text-sm text-muted-foreground" data-testid={`text-type-${id.id}`}>
                          {getTypeName(id.typeId)}
                        </Label>
                        <p className="text-lg font-semibold text-foreground font-mono" data-testid={`text-value-${id.id}`}>
                          {id.value}
                        </p>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          onClick={() => handleEdit(id)}
                          variant="outline"
                          size="sm"
                          data-testid={`button-edit-${id.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          onClick={() => setDeleteId(id.id)}
                          variant="outline"
                          size="sm"
                          data-testid={`button-delete-${id.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent data-testid="dialog-add-worker-id">
          <DialogHeader>
            <DialogTitle>Add Worker ID</DialogTitle>
            <DialogDescription>
              Create a new identification number for this worker.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-type">Type</Label>
              <Select value={formTypeId} onValueChange={setFormTypeId}>
                <SelectTrigger id="add-type" data-testid="select-add-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {workerIdTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id} data-testid={`option-add-type-${type.id}`}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-value">Value</Label>
              <Input
                id="add-value"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder="Enter ID value"
                data-testid="input-add-value"
              />
              {selectedTypeValidator && (
                <p className="text-xs text-muted-foreground">
                  Pattern: <code>{selectedTypeValidator}</code>
                </p>
              )}
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
              Add ID
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Worker ID</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this worker ID? This action cannot be undone.
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
