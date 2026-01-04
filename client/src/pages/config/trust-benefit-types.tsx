import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X, ArrowUp, ArrowDown, Scale, Stethoscope, Smile, Eye, Star, Home, GraduationCap, Heart, Laptop, ShoppingBag, type LucideIcon } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TrustBenefitType {
  id: string;
  name: string;
  data?: { icon?: string } | null;
  sequence: number;
}

// Available icons for benefit types
const availableIcons: { name: string; Icon: LucideIcon }[] = [
  { name: 'Scale', Icon: Scale },
  { name: 'Stethoscope', Icon: Stethoscope },
  { name: 'Smile', Icon: Smile },
  { name: 'Eye', Icon: Eye },
  { name: 'Star', Icon: Star },
  { name: 'Home', Icon: Home },
  { name: 'GraduationCap', Icon: GraduationCap },
  { name: 'Heart', Icon: Heart },
  { name: 'Laptop', Icon: Laptop },
  { name: 'ShoppingBag', Icon: ShoppingBag },
];

export default function TrustBenefitTypesPage() {
  usePageTitle("Trust Benefit Types");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formIcon, setFormIcon] = useState<string>("Star");
  
  const { data: trustBenefitTypes = [], isLoading } = useQuery<TrustBenefitType[]>({
    queryKey: ["/api/trust-benefit-types"],
  });

  const createMutation = useMutation({
    mutationFn: async (formData: { name: string; icon: string }) => {
      // Find the highest sequence number
      const maxSequence = trustBenefitTypes.reduce((max, option) => Math.max(max, option.sequence), -1);
      return apiRequest("POST", "/api/trust-benefit-types", { 
        name: formData.name,
        sequence: maxSequence + 1,
        data: { icon: formData.icon }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-benefit-types"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Trust benefit type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create trust benefit type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (formData: { id: string; name: string; icon: string }) => {
      return apiRequest("PUT", `/api/trust-benefit-types/${formData.id}`, {
        name: formData.name,
        data: { icon: formData.icon },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-benefit-types"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Trust benefit type updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update trust benefit type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/trust-benefit-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-benefit-types"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Trust benefit type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete trust benefit type.",
        variant: "destructive",
      });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: { id: string; sequence: number }) => {
      return apiRequest("PUT", `/api/trust-benefit-types/${data.id}`, {
        sequence: data.sequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-benefit-types"] });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormIcon("Star");
  };

  const handleEdit = (option: TrustBenefitType) => {
    setEditingId(option.id);
    setFormName(option.name);
    setFormIcon(option.data?.icon || "Star");
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
      icon: formIcon,
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
      icon: formIcon,
    });
  };

  const moveUp = (option: TrustBenefitType) => {
    const currentIndex = trustBenefitTypes.findIndex(o => o.id === option.id);
    if (currentIndex > 0) {
      const prevOption = trustBenefitTypes[currentIndex - 1];
      updateSequenceMutation.mutate({ id: option.id, sequence: prevOption.sequence });
      updateSequenceMutation.mutate({ id: prevOption.id, sequence: option.sequence });
    }
  };

  const moveDown = (option: TrustBenefitType) => {
    const currentIndex = trustBenefitTypes.findIndex(o => o.id === option.id);
    if (currentIndex < trustBenefitTypes.length - 1) {
      const nextOption = trustBenefitTypes[currentIndex + 1];
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
        <h1 className="text-3xl font-bold" data-testid="heading-trust-benefit-types">
          Trust Benefit Types
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-trust-benefit-type">
          <Plus className="mr-2 h-4 w-4" />
          Add Trust Benefit Type
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trust Benefit Types Management</CardTitle>
          <CardDescription>
            Configure trust benefit types for use throughout the application. Use the arrows to reorder types.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trustBenefitTypes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-types">
              No trust benefit types configured yet. Click "Add Trust Benefit Type" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Icon</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trustBenefitTypes.map((option, index) => (
                  <TableRow key={option.id} data-testid={`row-trust-benefit-type-${option.id}`}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveUp(option)}
                          disabled={index === 0}
                          data-testid={`button-move-up-${option.id}`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveDown(option)}
                          disabled={index === trustBenefitTypes.length - 1}
                          data-testid={`button-move-down-${option.id}`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`icon-${option.id}`}>
                      {editingId === option.id ? (
                        <Select value={formIcon} onValueChange={setFormIcon}>
                          <SelectTrigger data-testid={`select-edit-icon-${option.id}`} className="w-32">
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
                      ) : (
                        (() => {
                          const selectedIcon = availableIcons.find(i => i.name === option.data?.icon);
                          const IconComponent = selectedIcon?.Icon || Star;
                          return <IconComponent size={20} className="text-muted-foreground" />;
                        })()
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-name-${option.id}`}>
                      {editingId === option.id ? (
                        <Input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          data-testid={`input-edit-name-${option.id}`}
                        />
                      ) : (
                        option.name
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === option.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${option.id}`}
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
                            data-testid={`button-cancel-edit-${option.id}`}
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
                            data-testid={`button-edit-${option.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(option.id)}
                            data-testid={`button-delete-${option.id}`}
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
        <DialogContent data-testid="dialog-add-trust-benefit-type">
          <DialogHeader>
            <DialogTitle>Add Trust Benefit Type</DialogTitle>
            <DialogDescription>
              Create a new trust benefit type for the application.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                placeholder="e.g., Health Insurance, Dental Coverage"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-add-name"
              />
            </div>
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
            <DialogTitle>Delete Trust Benefit Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this trust benefit type? This action cannot be undone.
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
