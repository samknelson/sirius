import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface GenderOption {
  id: string;
  name: string;
  code: string;
  nota: boolean;
  sequence: number;
}

export default function GenderOptionsPage() {
  usePageTitle("Gender Options");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formNota, setFormNota] = useState(false);
  
  const { data: genderOptions = [], isLoading } = useQuery<GenderOption[]>({
    queryKey: ["/api/gender-options"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; code: string; nota: boolean }) => {
      // Find the highest sequence number
      const maxSequence = genderOptions.reduce((max, option) => Math.max(max, option.sequence), -1);
      return apiRequest("POST", "/api/gender-options", { 
        ...data, 
        sequence: maxSequence + 1 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gender-options"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Gender option created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create gender option.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; code: string; nota: boolean }) => {
      return apiRequest("PUT", `/api/gender-options/${data.id}`, {
        name: data.name,
        code: data.code,
        nota: data.nota,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gender-options"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Gender option updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update gender option.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/gender-options/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gender-options"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Gender option deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete gender option.",
        variant: "destructive",
      });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: { id: string; sequence: number }) => {
      return apiRequest("PUT", `/api/gender-options/${data.id}`, {
        sequence: data.sequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gender-options"] });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormCode("");
    setFormNota(false);
  };

  const handleEdit = (option: GenderOption) => {
    setEditingId(option.id);
    setFormName(option.name);
    setFormCode(option.code);
    setFormNota(option.nota);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    resetForm();
  };

  const handleSaveEdit = () => {
    if (!formName.trim() || !formCode.trim()) {
      toast({
        title: "Validation Error",
        description: "Name and Code are required.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({
      id: editingId!,
      name: formName.trim(),
      code: formCode.trim(),
      nota: formNota,
    });
  };

  const handleCreate = () => {
    if (!formName.trim() || !formCode.trim()) {
      toast({
        title: "Validation Error",
        description: "Name and Code are required.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: formName.trim(),
      code: formCode.trim(),
      nota: formNota,
    });
  };

  const moveUp = (option: GenderOption) => {
    const currentIndex = genderOptions.findIndex(o => o.id === option.id);
    if (currentIndex > 0) {
      const prevOption = genderOptions[currentIndex - 1];
      updateSequenceMutation.mutate({ id: option.id, sequence: prevOption.sequence });
      updateSequenceMutation.mutate({ id: prevOption.id, sequence: option.sequence });
    }
  };

  const moveDown = (option: GenderOption) => {
    const currentIndex = genderOptions.findIndex(o => o.id === option.id);
    if (currentIndex < genderOptions.length - 1) {
      const nextOption = genderOptions[currentIndex + 1];
      updateSequenceMutation.mutate({ id: option.id, sequence: nextOption.sequence });
      updateSequenceMutation.mutate({ id: nextOption.id, sequence: option.sequence });
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
        <h1 className="text-3xl font-bold" data-testid="heading-gender-options">
          Gender Options
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-gender-option">
          <Plus className="mr-2 h-4 w-4" />
          Add Gender Option
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gender Options Management</CardTitle>
          <CardDescription>
            Configure gender options for use throughout the application. Use the arrows to reorder options.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {genderOptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-options">
              No gender options configured yet. Click "Add Gender Option" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>None of the Above</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {genderOptions.map((option, index) => (
                  <TableRow key={option.id} data-testid={`row-gender-option-\${option.id}`}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveUp(option)}
                          disabled={index === 0}
                          data-testid={`button-move-up-\${option.id}`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveDown(option)}
                          disabled={index === genderOptions.length - 1}
                          data-testid={`button-move-down-\${option.id}`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-name-\${option.id}`}>
                      {editingId === option.id ? (
                        <Input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          data-testid={`input-edit-name-\${option.id}`}
                        />
                      ) : (
                        option.name
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-code-\${option.id}`}>
                      {editingId === option.id ? (
                        <Input
                          value={formCode}
                          onChange={(e) => setFormCode(e.target.value)}
                          data-testid={`input-edit-code-\${option.id}`}
                        />
                      ) : (
                        option.code
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-nota-\${option.id}`}>
                      {editingId === option.id ? (
                        <Checkbox
                          checked={formNota}
                          onCheckedChange={(checked) => setFormNota(checked as boolean)}
                          data-testid={`checkbox-edit-nota-\${option.id}`}
                        />
                      ) : (
                        option.nota ? "Yes" : "No"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === option.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-\${option.id}`}
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
                            data-testid={`button-cancel-edit-\${option.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(option)}
                            data-testid={`button-edit-\${option.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(option.id)}
                            data-testid={`button-delete-\${option.id}`}
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
        <DialogContent data-testid="dialog-add-gender-option">
          <DialogHeader>
            <DialogTitle>Add Gender Option</DialogTitle>
            <DialogDescription>
              Create a new gender option for the application.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                placeholder="e.g., Male, Female, Non-binary"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-code">Code</Label>
              <Input
                id="add-code"
                placeholder="e.g., M, F, NB"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                data-testid="input-add-code"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="add-nota"
                checked={formNota}
                onCheckedChange={(checked) => setFormNota(checked as boolean)}
                data-testid="checkbox-add-nota"
              />
              <Label htmlFor="add-nota" className="cursor-pointer">
                Mark as "None of the Above" option
              </Label>
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
              Add Option
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Gender Option</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this gender option? This action cannot be undone.
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
