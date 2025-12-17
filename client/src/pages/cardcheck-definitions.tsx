import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Plus, Loader2, Trash2, Eye, Pencil } from "lucide-react";
import { CardcheckDefinition } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IconPicker, renderIcon } from "@/components/ui/icon-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function CardcheckDefinitionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [formSiriusId, setFormSiriusId] = useState("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIcon, setFormIcon] = useState<string | undefined>(undefined);

  const { data: definitions = [], isLoading } = useQuery<CardcheckDefinition[]>({
    queryKey: ["/api/cardcheck/definitions"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { siriusId: string; name: string; description?: string; data?: any }) => {
      return apiRequest("POST", "/api/cardcheck/definitions", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cardcheck/definitions"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Cardcheck definition created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create cardcheck definition.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/cardcheck/definition/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cardcheck/definitions"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Cardcheck definition deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete cardcheck definition.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormSiriusId("");
    setFormName("");
    setFormDescription("");
    setFormIcon(undefined);
  };

  const handleCreate = () => {
    if (!formSiriusId.trim()) {
      toast({
        title: "Validation Error",
        description: "Sirius ID is required.",
        variant: "destructive",
      });
      return;
    }

    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      siriusId: formSiriusId.trim(),
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      data: formIcon ? { icon: formIcon } : undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="heading-cardcheck-definitions">
              Cardcheck Definitions
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage cardcheck definitions and their configurations
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-cardcheck-definition">
            <Plus className="h-4 w-4 mr-2" />
            Add Definition
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Cardcheck Definitions
            </CardTitle>
            <CardDescription>
              {definitions.length} definition{definitions.length !== 1 ? "s" : ""} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {definitions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No cardcheck definitions configured yet.</p>
                <p className="text-sm mt-2">Click "Add Definition" to create one.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Icon</TableHead>
                    <TableHead>Sirius ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {definitions.map((definition) => {
                    const iconName = (definition.data as any)?.icon;
                    return (
                    <TableRow key={definition.id} data-testid={`row-cardcheck-definition-${definition.id}`}>
                      <TableCell>
                        {iconName ? (
                          renderIcon(iconName, "h-5 w-5 text-muted-foreground")
                        ) : (
                          <FileText className="h-5 w-5 text-muted-foreground/50" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm" data-testid={`text-sirius-id-${definition.id}`}>
                        {definition.siriusId}
                      </TableCell>
                      <TableCell data-testid={`text-name-${definition.id}`}>
                        {definition.name}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {definition.description || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/cardcheck-definitions/${definition.id}`}>
                            <Button variant="ghost" size="icon" data-testid={`button-view-${definition.id}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link href={`/cardcheck-definitions/${definition.id}/edit`}>
                            <Button variant="ghost" size="icon" data-testid={`button-edit-${definition.id}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(definition.id)}
                            data-testid={`button-delete-${definition.id}`}
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
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Cardcheck Definition</DialogTitle>
            <DialogDescription>
              Create a new cardcheck definition with a unique Sirius ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-sirius-id">Sirius ID *</Label>
              <Input
                id="add-sirius-id"
                placeholder="Enter Sirius ID..."
                value={formSiriusId}
                onChange={(e) => setFormSiriusId(e.target.value)}
                data-testid="input-add-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-name">Name *</Label>
              <Input
                id="add-name"
                placeholder="Enter name..."
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <Textarea
                id="add-description"
                placeholder="Enter description..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                data-testid="input-add-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Icon</Label>
              <IconPicker
                value={formIcon}
                onChange={setFormIcon}
                placeholder="Select an icon..."
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button 
              onClick={handleCreate} 
              disabled={createMutation.isPending}
              data-testid="button-confirm-add"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Cardcheck Definition</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this cardcheck definition? This action cannot be undone.
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
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
