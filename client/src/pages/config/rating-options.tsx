import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface RatingOption {
  id: string;
  name: string;
  parent: string | null;
  data: Record<string, any> | null;
}

interface RatingWithLevel extends RatingOption {
  level: number;
}

function buildHierarchy(ratings: RatingOption[]): RatingWithLevel[] {
  const result: RatingWithLevel[] = [];
  const childrenMap = new Map<string | null, RatingOption[]>();
  
  for (const rating of ratings) {
    const parentKey = rating.parent || null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)!.push(rating);
  }

  Array.from(childrenMap.values()).forEach(children => {
    children.sort((a: RatingOption, b: RatingOption) => a.name.localeCompare(b.name));
  });

  const processed = new Set<string>();

  function addWithChildren(rating: RatingOption, level: number) {
    if (processed.has(rating.id)) return;
    processed.add(rating.id);
    result.push({ ...rating, level });
    
    const children = childrenMap.get(rating.id) || [];
    for (const child of children) {
      addWithChildren(child, level + 1);
    }
  }

  const topLevel = childrenMap.get(null) || [];
  for (const rating of topLevel) {
    addWithChildren(rating, 0);
  }

  for (const rating of ratings) {
    if (!processed.has(rating.id)) {
      result.push({ ...rating, level: 0 });
      processed.add(rating.id);
    }
  }

  return result;
}

export default function RatingOptionsPage() {
  usePageTitle("Rating Types");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [formName, setFormName] = useState("");
  const [formParent, setFormParent] = useState<string | null>(null);
  
  const { data: ratingOptions = [], isLoading } = useQuery<RatingOption[]>({
    queryKey: ["/api/options/worker-rating"],
  });

  const hierarchicalRatings = useMemo(() => buildHierarchy(ratingOptions), [ratingOptions]);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; parent: string | null }) => {
      return apiRequest("POST", "/api/options/worker-rating", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/worker-rating"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Rating type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create rating type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; parent: string | null }) => {
      return apiRequest("PUT", `/api/options/worker-rating/${data.id}`, {
        name: data.name,
        parent: data.parent,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/worker-rating"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Rating type updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update rating type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/options/worker-rating/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/worker-rating"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Rating type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete rating type.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormParent(null);
  };

  const handleEdit = (rating: RatingOption) => {
    setEditingId(rating.id);
    setFormName(rating.name);
    setFormParent(rating.parent);
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
    if (formParent === editingId) {
      toast({
        title: "Validation Error",
        description: "A rating cannot be its own parent.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({
      id: editingId!,
      name: formName.trim(),
      parent: formParent,
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
      parent: formParent,
    });
  };

  const getParentOptions = (excludeId?: string) => {
    return ratingOptions.filter(r => r.id !== excludeId);
  };

  const getParentName = (parentId: string | null) => {
    if (!parentId) return null;
    const parent = ratingOptions.find(r => r.id === parentId);
    return parent?.name || null;
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
        <h1 className="text-3xl font-bold" data-testid="heading-rating-options">
          Rating Types
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-rating-option">
          <Plus className="mr-2 h-4 w-4" />
          Add Rating Type
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rating Types Management</CardTitle>
          <CardDescription>
            Manage the rating types that can be used to rate workers. Ratings can have parent ratings to create a hierarchy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ratingOptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-ratings">
              No rating types configured yet. Click "Add Rating Type" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hierarchicalRatings.map((rating) => (
                  <TableRow key={rating.id} data-testid={`row-rating-option-${rating.id}`}>
                    <TableCell data-testid={`text-name-${rating.id}`}>
                      {editingId === rating.id ? (
                        <Input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder="Name"
                          data-testid={`input-edit-name-${rating.id}`}
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          {rating.level > 0 && (
                            <span 
                              className="text-muted-foreground"
                              style={{ paddingLeft: `${rating.level * 1.5}rem` }}
                            >
                              <ChevronRight className="h-4 w-4 inline" />
                            </span>
                          )}
                          {rating.name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-parent-${rating.id}`}>
                      {editingId === rating.id ? (
                        <Select
                          value={formParent || "_none_"}
                          onValueChange={(v) => setFormParent(v === "_none_" ? null : v)}
                        >
                          <SelectTrigger data-testid={`select-edit-parent-${rating.id}`}>
                            <SelectValue placeholder="No parent" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none_">No parent</SelectItem>
                            {getParentOptions(rating.id).map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        getParentName(rating.parent) || <span className="text-muted-foreground italic">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === rating.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${rating.id}`}
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
                            data-testid={`button-cancel-edit-${rating.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(rating)}
                            data-testid={`button-edit-${rating.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(rating.id)}
                            data-testid={`button-delete-${rating.id}`}
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
        <DialogContent data-testid="dialog-add-rating-option">
          <DialogHeader>
            <DialogTitle>Add Rating Type</DialogTitle>
            <DialogDescription>
              Create a new rating type. You can optionally select a parent to create a hierarchy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Quality, Attendance, Teamwork"
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-parent">Parent Rating</Label>
              <Select
                value={formParent || "_none_"}
                onValueChange={(v) => setFormParent(v === "_none_" ? null : v)}
              >
                <SelectTrigger data-testid="select-add-parent">
                  <SelectValue placeholder="No parent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">No parent</SelectItem>
                  {ratingOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
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
              Add Rating Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Rating Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this rating type? This action cannot be undone.
              Child ratings will become top-level ratings.
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
