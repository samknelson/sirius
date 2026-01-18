import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X } from "lucide-react";
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

interface ClassificationOption {
  id: string;
  name: string;
  code: string | null;
  siriusId: string | null;
  data: Record<string, unknown> | null;
}

export default function ClassificationOptionsPage() {
  usePageTitle("Classification Options");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formSiriusId, setFormSiriusId] = useState("");
  
  const { data: classificationOptions = [], isLoading } = useQuery<ClassificationOption[]>({
    queryKey: ["/api/options/classification"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; code: string | null; siriusId: string | null }) => {
      return apiRequest("POST", "/api/options/classification", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/classification"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Classification created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create classification.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; code: string | null; siriusId: string | null }) => {
      return apiRequest("PUT", `/api/options/classification/${data.id}`, {
        name: data.name,
        code: data.code,
        siriusId: data.siriusId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/classification"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Classification updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update classification.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/options/classification/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/classification"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Classification deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete classification.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormCode("");
    setFormSiriusId("");
  };

  const handleEdit = (classification: ClassificationOption) => {
    setEditingId(classification.id);
    setFormName(classification.name);
    setFormCode(classification.code || "");
    setFormSiriusId(classification.siriusId || "");
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
      code: formCode.trim() || null,
      siriusId: formSiriusId.trim() || null,
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
      code: formCode.trim() || null,
      siriusId: formSiriusId.trim() || null,
    });
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
      <div className="flex justify-between items-center mb-6 gap-4 flex-wrap">
        <h1 className="text-3xl font-bold" data-testid="heading-classification-options">
          Classification Options
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-classification">
          <Plus className="mr-2 h-4 w-4" />
          Add Classification
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Classification Options Management</CardTitle>
          <CardDescription>
            Manage the classifications that can be assigned to workers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {classificationOptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-classifications">
              No classifications configured yet. Click "Add Classification" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classificationOptions.map((classification) => (
                  <TableRow key={classification.id} data-testid={`row-classification-${classification.id}`}>
                    <TableCell data-testid={`text-name-${classification.id}`}>
                      {editingId === classification.id ? (
                        <Input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder="Name"
                          data-testid={`input-edit-name-${classification.id}`}
                        />
                      ) : (
                        classification.name
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-code-${classification.id}`}>
                      {editingId === classification.id ? (
                        <Input
                          value={formCode}
                          onChange={(e) => setFormCode(e.target.value)}
                          placeholder="Code (optional)"
                          data-testid={`input-edit-code-${classification.id}`}
                        />
                      ) : (
                        classification.code || <span className="text-muted-foreground italic">None</span>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-sirius-id-${classification.id}`}>
                      {editingId === classification.id ? (
                        <Input
                          value={formSiriusId}
                          onChange={(e) => setFormSiriusId(e.target.value)}
                          placeholder="Sirius ID (optional)"
                          data-testid={`input-edit-sirius-id-${classification.id}`}
                        />
                      ) : (
                        classification.siriusId || <span className="text-muted-foreground italic">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === classification.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${classification.id}`}
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
                            data-testid={`button-cancel-edit-${classification.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(classification)}
                            data-testid={`button-edit-${classification.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(classification.id)}
                            data-testid={`button-delete-${classification.id}`}
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

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Classification</DialogTitle>
            <DialogDescription>
              Create a new classification option.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Enter name"
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="Enter code (optional)"
                data-testid="input-add-code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siriusId">Sirius ID</Label>
              <Input
                id="siriusId"
                value={formSiriusId}
                onChange={(e) => setFormSiriusId(e.target.value)}
                placeholder="Enter Sirius ID (optional)"
                data-testid="input-add-sirius-id"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsAddDialogOpen(false); resetForm(); }} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-confirm-add">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Classification</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this classification? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
