import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface EmployerContactType {
  id: string;
  name: string;
  description: string | null;
}

export default function EmployerContactTypesPage() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  
  const { data: contactTypes = [], isLoading } = useQuery<EmployerContactType[]>({
    queryKey: ["/api/employer-contact-types"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string | null }) => {
      return apiRequest("POST", "/api/employer-contact-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employer-contact-types"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Employer contact type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create employer contact type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description: string | null }) => {
      return apiRequest("PUT", `/api/employer-contact-types/${data.id}`, {
        name: data.name,
        description: data.description,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employer-contact-types"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Employer contact type updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update employer contact type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/employer-contact-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employer-contact-types"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Employer contact type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employer contact type.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
  };

  const handleEdit = (type: EmployerContactType) => {
    setEditingId(type.id);
    setFormName(type.name);
    setFormDescription(type.description || "");
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle data-testid="title-page">Employer Contact Types</CardTitle>
              <CardDescription>
                Manage employer contact types for categorizing employer relationships
              </CardDescription>
            </div>
            <Button data-testid="button-add" onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Type
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {contactTypes.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No employer contact types configured yet. Click "Add Type" to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contactTypes.map((type) => (
                  <TableRow key={type.id} data-testid={`row-type-${type.id}`}>
                    {editingId === type.id ? (
                      <>
                        <TableCell>
                          <Input
                            data-testid="input-name"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="Name"
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            data-testid="input-description"
                            value={formDescription}
                            onChange={(e) => setFormDescription(e.target.value)}
                            placeholder="Description (optional)"
                            rows={2}
                          />
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            data-testid="button-save"
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                          >
                            {updateMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            data-testid="button-cancel"
                            size="sm"
                            variant="outline"
                            onClick={handleCancelEdit}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell data-testid={`text-name-${type.id}`}>{type.name}</TableCell>
                        <TableCell data-testid={`text-description-${type.id}`}>
                          {type.description || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            data-testid={`button-edit-${type.id}`}
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(type)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            data-testid={`button-delete-${type.id}`}
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(type.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Employer Contact Type</DialogTitle>
            <DialogDescription>
              Create a new employer contact type to categorize employer relationships.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="add-name">Name *</Label>
              <Input
                id="add-name"
                data-testid="input-add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Primary Contact, Billing Contact"
              />
            </div>
            <div>
              <Label htmlFor="add-description">Description</Label>
              <Textarea
                id="add-description"
                data-testid="input-add-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              data-testid="button-create"
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Employer Contact Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this employer contact type? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="button-confirm-delete"
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
            <Button
              data-testid="button-cancel-delete"
              variant="outline"
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
