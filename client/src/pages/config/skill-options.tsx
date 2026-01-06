import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X } from "lucide-react";
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

interface SkillOption {
  id: string;
  name: string;
  description: string | null;
  data: { icon?: string } | null;
}

export default function SkillOptionsPage() {
  usePageTitle("Skill Options");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIcon, setFormIcon] = useState<string | undefined>(undefined);
  
  const { data: skillOptions = [], isLoading } = useQuery<SkillOption[]>({
    queryKey: ["/api/skill-options"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string | null; data: { icon?: string } | null }) => {
      return apiRequest("POST", "/api/skill-options", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skill-options"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Skill option created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create skill option.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description: string | null; data: { icon?: string } | null }) => {
      return apiRequest("PUT", `/api/skill-options/${data.id}`, {
        name: data.name,
        description: data.description,
        data: data.data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skill-options"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Skill option updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update skill option.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/skill-options/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skill-options"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Skill option deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete skill option.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormIcon(undefined);
  };

  const handleEdit = (skill: SkillOption) => {
    setEditingId(skill.id);
    setFormName(skill.name);
    setFormDescription(skill.description || "");
    setFormIcon(skill.data?.icon || undefined);
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
      data: formIcon ? { icon: formIcon } : null,
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
      data: formIcon ? { icon: formIcon } : null,
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
        <h1 className="text-3xl font-bold" data-testid="heading-skill-options">
          Skill Options
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-skill-option">
          <Plus className="mr-2 h-4 w-4" />
          Add Skill
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Skill Options Management</CardTitle>
          <CardDescription>
            Manage the skills and qualifications that can be assigned to workers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {skillOptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-skills">
              No skill options configured yet. Click "Add Skill" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Icon</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skillOptions.map((skill) => (
                  <TableRow key={skill.id} data-testid={`row-skill-option-${skill.id}`}>
                    <TableCell data-testid={`icon-${skill.id}`}>
                      {editingId === skill.id ? (
                        <IconPicker
                          value={formIcon}
                          onChange={setFormIcon}
                          placeholder="Select icon"
                          data-testid={`picker-edit-icon-${skill.id}`}
                        />
                      ) : (
                        skill.data?.icon ? (
                          renderIcon(skill.data.icon, "h-5 w-5 text-muted-foreground")
                        ) : (
                          <span className="text-muted-foreground italic">None</span>
                        )
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-name-${skill.id}`}>
                      {editingId === skill.id ? (
                        <Input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder="Name"
                          data-testid={`input-edit-name-${skill.id}`}
                        />
                      ) : (
                        skill.name
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-description-${skill.id}`}>
                      {editingId === skill.id ? (
                        <Input
                          value={formDescription}
                          onChange={(e) => setFormDescription(e.target.value)}
                          placeholder="Description (optional)"
                          data-testid={`input-edit-description-${skill.id}`}
                        />
                      ) : (
                        skill.description || <span className="text-muted-foreground italic">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === skill.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${skill.id}`}
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
                            data-testid={`button-cancel-edit-${skill.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(skill)}
                            data-testid={`button-edit-${skill.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(skill.id)}
                            data-testid={`button-delete-${skill.id}`}
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
        <DialogContent data-testid="dialog-add-skill-option">
          <DialogHeader>
            <DialogTitle>Add Skill Option</DialogTitle>
            <DialogDescription>
              Create a new skill or qualification that can be assigned to workers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Welding, Plumbing, Electrical"
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <Textarea
                id="add-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description of this skill"
                data-testid="input-add-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Icon</Label>
              <IconPicker
                value={formIcon}
                onChange={setFormIcon}
                placeholder="Select an icon (optional)"
                data-testid="picker-add-icon"
              />
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
              Add Skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Skill Option</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this skill option? This action cannot be undone.
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
