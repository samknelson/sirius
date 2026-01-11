import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Loader2, Plus, Edit, Trash2, Save, X,
  Building, Building2, Factory, Store, Warehouse, Home, Landmark, Hospital,
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
import { insertEmployerTypeSchema, type EmployerType, type InsertEmployerType } from "@shared/schema";

const availableIcons: { name: string; Icon: LucideIcon }[] = [
  { name: 'Building', Icon: Building },
  { name: 'Building2', Icon: Building2 },
  { name: 'Factory', Icon: Factory },
  { name: 'Store', Icon: Store },
  { name: 'Warehouse', Icon: Warehouse },
  { name: 'Home', Icon: Home },
  { name: 'Landmark', Icon: Landmark },
  { name: 'Hospital', Icon: Hospital },
];

export default function EmployerTypesPage() {
  usePageTitle("Employer Types");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formIcon, setFormIcon] = useState<string>("Building");
  
  const { data: employerTypes = [], isLoading } = useQuery<EmployerType[]>({
    queryKey: ["/api/options/employer-type"],
  });

  const addForm = useForm<InsertEmployerType>({
    resolver: zodResolver(insertEmployerTypeSchema),
    defaultValues: {
      name: "",
      description: "",
      sequence: 0,
    },
  });

  const editForm = useForm<InsertEmployerType>({
    resolver: zodResolver(insertEmployerTypeSchema),
    defaultValues: {
      name: "",
      description: "",
      sequence: 0,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertEmployerType) => {
      return apiRequest("POST", "/api/options/employer-type", {
        ...data,
        data: { icon: formIcon }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/employer-type"] });
      setIsAddDialogOpen(false);
      addForm.reset();
      setFormIcon("Building");
      toast({
        title: "Success",
        description: "Employer type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create employer type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: InsertEmployerType }) => {
      return apiRequest("PUT", `/api/options/employer-type/${data.id}`, {
        ...data.updates,
        data: { icon: formIcon }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/employer-type"] });
      setEditingId(null);
      editForm.reset();
      setFormIcon("Building");
      toast({
        title: "Success",
        description: "Employer type updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update employer type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/options/employer-type/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/employer-type"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Employer type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employer type.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (type: EmployerType) => {
    setEditingId(type.id);
    const data = type.data as { icon?: string } | null;
    setFormIcon(data?.icon || "Building");
    editForm.reset({
      name: type.name,
      description: type.description || "",
      sequence: type.sequence,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    editForm.reset();
    setFormIcon("Building");
  };

  const onAddSubmit = (data: InsertEmployerType) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: InsertEmployerType) => {
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
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle data-testid="title-page">Employer Types</CardTitle>
              <CardDescription>
                Manage employer types for categorizing employers
              </CardDescription>
            </div>
            <Button data-testid="button-add" onClick={() => {
              setFormIcon("Building");
              setIsAddDialogOpen(true);
            }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Type
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {employerTypes.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-state">
              No employer types configured yet. Click "Add Type" to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Icon</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[100px]">Sequence</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employerTypes.map((type) => (
                  <TableRow key={type.id} data-testid={`row-type-${type.id}`}>
                    {editingId === type.id ? (
                      <>
                        <TableCell colSpan={5}>
                          <Form {...editForm}>
                            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                              <div className="grid grid-cols-3 gap-4">
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
                                          placeholder="e.g., Corporation"
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
                                  name="sequence"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Sequence</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          placeholder="0"
                                          data-testid="input-edit-sequence"
                                          {...field}
                                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
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
                            const IconComponent = selectedIcon?.Icon || Building;
                            return <IconComponent size={20} className="text-muted-foreground" />;
                          })()}
                        </TableCell>
                        <TableCell data-testid={`text-name-${type.id}`}>{type.name}</TableCell>
                        <TableCell data-testid={`text-description-${type.id}`}>
                          {type.description || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell data-testid={`text-sequence-${type.id}`}>{type.sequence}</TableCell>
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

      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        setIsAddDialogOpen(open);
        if (!open) {
          addForm.reset();
          setFormIcon("Building");
        }
      }}>
        <DialogContent data-testid="dialog-add">
          <DialogHeader>
            <DialogTitle>Add Employer Type</DialogTitle>
            <DialogDescription>
              Create a new employer type to categorize employers.
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
                        placeholder="e.g., Corporation, LLC, Non-Profit"
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
              <FormField
                control={addForm.control}
                name="sequence"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sequence</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="0"
                        data-testid="input-add-sequence"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
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

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete">
          <DialogHeader>
            <DialogTitle>Delete Employer Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this employer type? This action cannot be undone.
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
