import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2 } from "lucide-react";
import { IconPicker, renderIcon } from "@/components/ui/icon-picker";
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
import { insertOptionsCertificationsSchema, type OptionsCertification, type InsertOptionsCertification } from "@shared/schema";

const formSchema = insertOptionsCertificationsSchema.extend({
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or less"),
  siriusId: z.string().max(100, "Sirius ID must be 100 characters or less").optional().nullable(),
  icon: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function CertificationOptionsPage() {
  usePageTitle("Certification Options");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingCertification, setEditingCertification] = useState<OptionsCertification | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const addForm = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      siriusId: "",
      icon: "",
    },
  });

  const editForm = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      siriusId: "",
      icon: "",
    },
  });

  const { data: certificationOptions = [], isLoading } = useQuery<OptionsCertification[]>({
    queryKey: ["/api/options/certification"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertOptionsCertification) => {
      return apiRequest("POST", "/api/options/certification", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/certification"] });
      setIsAddDialogOpen(false);
      addForm.reset();
      toast({
        title: "Success",
        description: "Certification option created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create certification option.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & InsertOptionsCertification) => {
      return apiRequest("PUT", `/api/options/certification/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/certification"] });
      setEditingCertification(null);
      editForm.reset();
      toast({
        title: "Success",
        description: "Certification option updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update certification option.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/options/certification/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/certification"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Certification option deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete certification option.",
        variant: "destructive",
      });
    },
  });

  const handleOpenEdit = (certification: OptionsCertification) => {
    const iconValue = (certification.data as { icon?: string } | null)?.icon || "";
    editForm.reset({
      name: certification.name,
      siriusId: certification.siriusId || "",
      icon: iconValue,
    });
    setEditingCertification(certification);
  };

  const handleCloseEdit = (open: boolean) => {
    if (!open) {
      editForm.reset();
      setEditingCertification(null);
    }
  };

  const handleSaveEdit = (values: FormValues) => {
    if (!editingCertification) return;
    updateMutation.mutate({
      id: editingCertification.id,
      name: values.name,
      siriusId: values.siriusId || null,
      data: values.icon ? { icon: values.icon } : null,
    });
  };

  const handleCreate = (values: FormValues) => {
    createMutation.mutate({
      name: values.name,
      siriusId: values.siriusId || null,
      data: values.icon ? { icon: values.icon } : null,
    });
  };

  const handleAddDialogClose = (open: boolean) => {
    if (!open) {
      addForm.reset();
    }
    setIsAddDialogOpen(open);
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
        <h1 className="text-3xl font-bold" data-testid="heading-certification-options">
          Certification Options
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-certification-option">
          <Plus className="mr-2 h-4 w-4" />
          Add Certification
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Certification Options Management</CardTitle>
          <CardDescription>
            Manage the certifications and credentials that can be assigned to workers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {certificationOptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-certifications">
              No certification options configured yet. Click "Add Certification" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Icon</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {certificationOptions.map((certification) => {
                  const iconName = (certification.data as { icon?: string } | null)?.icon;
                  return (
                    <TableRow key={certification.id} data-testid={`row-certification-option-${certification.id}`}>
                      <TableCell data-testid={`icon-${certification.id}`}>
                        {iconName ? (
                          renderIcon(iconName, "h-5 w-5 text-muted-foreground")
                        ) : (
                          <span className="text-muted-foreground italic">None</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-name-${certification.id}`}>
                        {certification.name}
                      </TableCell>
                      <TableCell data-testid={`text-sirius-id-${certification.id}`}>
                        {certification.siriusId || <span className="text-muted-foreground italic">None</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenEdit(certification)}
                            data-testid={`button-edit-${certification.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(certification.id)}
                            data-testid={`button-delete-${certification.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={handleAddDialogClose}>
        <DialogContent data-testid="dialog-add-certification-option">
          <DialogHeader>
            <DialogTitle>Add Certification Option</DialogTitle>
            <DialogDescription>
              Create a new certification or credential that can be assigned to workers.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(handleCreate)} className="space-y-4 py-4">
              <FormField
                control={addForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., OSHA 10, First Aid, Forklift License"
                        data-testid="input-add-name"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-add-name" />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="siriusId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sirius ID</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="Optional external system ID"
                        data-testid="input-add-sirius-id"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-add-sirius-id" />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="icon"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Icon</FormLabel>
                    <FormControl>
                      <IconPicker
                        value={field.value || undefined}
                        onChange={(value) => field.onChange(value || "")}
                        placeholder="Select an icon (optional)"
                        data-testid="picker-add-icon"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-add-icon" />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleAddDialogClose(false)}
                  data-testid="button-cancel-add"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-submit-add"
                >
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Certification
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={editingCertification !== null} onOpenChange={handleCloseEdit}>
        <DialogContent data-testid="dialog-edit-certification-option">
          <DialogHeader>
            <DialogTitle>Edit Certification Option</DialogTitle>
            <DialogDescription>
              Update the certification or credential details.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleSaveEdit)} className="space-y-4 py-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., OSHA 10, First Aid, Forklift License"
                        data-testid="input-edit-name"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-edit-name" />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="siriusId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sirius ID</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="Optional external system ID"
                        data-testid="input-edit-sirius-id"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-edit-sirius-id" />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="icon"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Icon</FormLabel>
                    <FormControl>
                      <IconPicker
                        value={field.value || undefined}
                        onChange={(value) => field.onChange(value || "")}
                        placeholder="Select an icon (optional)"
                        data-testid="picker-edit-icon"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-edit-icon" />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleCloseEdit(false)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  data-testid="button-submit-edit"
                >
                  {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Certification Option</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this certification option? This action cannot be undone.
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
