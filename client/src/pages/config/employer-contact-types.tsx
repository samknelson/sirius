import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Loader2, Plus, Edit, Trash2, Save, X,
  User, Phone, Mail, Building, Briefcase, 
  FileText, CreditCard, Truck, HardHat, Users,
  type LucideIcon
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { insertEmployerContactTypeSchema, type EmployerContactType, type InsertEmployerContactType } from "@shared/schema";

const availableIcons: { name: string; Icon: LucideIcon }[] = [
  { name: 'User', Icon: User },
  { name: 'Phone', Icon: Phone },
  { name: 'Mail', Icon: Mail },
  { name: 'Building', Icon: Building },
  { name: 'Briefcase', Icon: Briefcase },
  { name: 'FileText', Icon: FileText },
  { name: 'CreditCard', Icon: CreditCard },
  { name: 'Truck', Icon: Truck },
  { name: 'HardHat', Icon: HardHat },
  { name: 'Users', Icon: Users },
];

export default function EmployerContactTypesPage() {
  usePageTitle("Employer Contact Types");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formIcon, setFormIcon] = useState<string>("User");
  
  const { data: contactTypes = [], isLoading } = useQuery<EmployerContactType[]>({
    queryKey: ["/api/options/employer-contact-type"],
  });

  const addForm = useForm<InsertEmployerContactType>({
    resolver: zodResolver(insertEmployerContactTypeSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const editForm = useForm<InsertEmployerContactType>({
    resolver: zodResolver(insertEmployerContactTypeSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertEmployerContactType) => {
      return apiRequest("POST", "/api/options/employer-contact-type", {
        ...data,
        data: { icon: formIcon }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/employer-contact-type"] });
      setIsAddDialogOpen(false);
      addForm.reset();
      setFormIcon("User");
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
    mutationFn: async (data: { id: string; updates: InsertEmployerContactType }) => {
      return apiRequest("PUT", `/api/options/employer-contact-type/${data.id}`, {
        ...data.updates,
        data: { icon: formIcon }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/employer-contact-type"] });
      setEditingId(null);
      editForm.reset();
      setFormIcon("User");
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
      return apiRequest("DELETE", `/api/options/employer-contact-type/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/employer-contact-type"] });
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

  const handleEdit = (type: EmployerContactType) => {
    setEditingId(type.id);
    const data = type.data as { icon?: string } | null;
    setFormIcon(data?.icon || "User");
    editForm.reset({
      name: type.name,
      description: type.description || "",
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormIcon("User");
    editForm.reset();
  };

  const onAddSubmit = (data: InsertEmployerContactType) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: InsertEmployerContactType) => {
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
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-state">
              No employer contact types configured yet. Click "Add Type" to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Icon</TableHead>
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
                        <TableCell colSpan={4}>
                          <Form {...editForm}>
                            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>Icon</Label>
                                  <Select value={formIcon} onValueChange={setFormIcon}>
                                    <SelectTrigger data-testid={`select-edit-icon-${type.id}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {availableIcons.map(({ name, Icon }) => (
                                        <SelectItem key={name} value={name}>
                                          <div className="flex items-center gap-2">
                                            <Icon size={16} />
                                            <span>{name}</span>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
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
                              </div>
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
                        <TableCell data-testid={`icon-${type.id}`}>
                          {(() => {
                            const data = type.data as { icon?: string } | null;
                            const selectedIcon = availableIcons.find(i => i.name === data?.icon);
                            const IconComponent = selectedIcon?.Icon || User;
                            return <IconComponent size={20} className="text-muted-foreground" />;
                          })()}
                        </TableCell>
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
      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        setIsAddDialogOpen(open);
        if (!open) {
          setFormIcon("User");
          addForm.reset();
        }
      }}>
        <DialogContent data-testid="dialog-add">
          <DialogHeader>
            <DialogTitle>Add Employer Contact Type</DialogTitle>
            <DialogDescription>
              Create a new employer contact type to categorize employer relationships.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="add-icon">Icon</Label>
                <Select value={formIcon} onValueChange={setFormIcon}>
                  <SelectTrigger id="add-icon" data-testid="select-add-icon">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableIcons.map(({ name, Icon }) => (
                      <SelectItem key={name} value={name}>
                        <div className="flex items-center gap-2">
                          <Icon size={16} />
                          <span>{name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
