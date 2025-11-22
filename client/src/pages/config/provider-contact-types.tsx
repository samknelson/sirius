import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { insertTrustProviderTypeSchema, type TrustProviderType, type InsertTrustProviderType } from "@shared/schema";

export default function ProviderContactTypesPage() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const { data: contactTypes = [], isLoading } = useQuery<TrustProviderType[]>({
    queryKey: ["/api/provider-contact-types"],
  });

  const addForm = useForm<InsertTrustProviderType>({
    resolver: zodResolver(insertTrustProviderTypeSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const editForm = useForm<InsertTrustProviderType>({
    resolver: zodResolver(insertTrustProviderTypeSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertTrustProviderType) => {
      return apiRequest("POST", "/api/provider-contact-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider-contact-types"] });
      setIsAddDialogOpen(false);
      addForm.reset();
      toast({
        title: "Success",
        description: "Provider contact type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create provider contact type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: InsertTrustProviderType }) => {
      return apiRequest("PUT", `/api/provider-contact-types/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider-contact-types"] });
      setEditingId(null);
      editForm.reset();
      toast({
        title: "Success",
        description: "Provider contact type updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update provider contact type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/provider-contact-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider-contact-types"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Provider contact type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete provider contact type.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (type: TrustProviderType) => {
    setEditingId(type.id);
    editForm.reset({
      name: type.name,
      description: type.description || "",
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    editForm.reset();
  };

  const onAddSubmit = (data: InsertTrustProviderType) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: InsertTrustProviderType) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, updates: data });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle data-testid="title-page">Provider Contact Types</CardTitle>
              <CardDescription>
                Manage provider contact types for categorizing provider relationships
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
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-state">
              No provider contact types configured yet. Click "Add Type" to get started.
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
                        <TableCell colSpan={3}>
                          <Form {...editForm}>
                            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                              <FormField
                                control={editForm.control}
                                name="name"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Name *</FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder="e.g., Primary Contact"
                                        data-testid="input-edit-name"
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={editForm.control}
                                name="description"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                      <Textarea
                                        placeholder="Optional description"
                                        rows={2}
                                        data-testid="input-edit-description"
                                        {...field}
                                        value={field.value || ""}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="submit"
                                  size="sm"
                                  data-testid="button-save"
                                  disabled={updateMutation.isPending}
                                >
                                  {updateMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <Save className="h-4 w-4 mr-2" />
                                      Save
                                    </>
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={handleCancelEdit}
                                  data-testid="button-cancel"
                                >
                                  <X className="h-4 w-4 mr-2" />
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          </Form>
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
        <DialogContent data-testid="dialog-add">
          <DialogHeader>
            <DialogTitle>Add Provider Contact Type</DialogTitle>
            <DialogDescription>
              Create a new provider contact type to categorize provider relationships.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
              <FormField
                control={addForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Primary Contact, Billing Contact"
                        data-testid="input-add-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Optional description"
                        rows={3}
                        data-testid="input-add-description"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="submit"
                  data-testid="button-create"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Type
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete">
          <DialogHeader>
            <DialogTitle>Delete Provider Contact Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this provider contact type? This action cannot be undone.
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
