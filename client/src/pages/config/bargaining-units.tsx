import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, Plus, Loader2, Trash2, Eye } from "lucide-react";
import { BargainingUnit } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function BargainingUnitsConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [formSiriusId, setFormSiriusId] = useState("");
  const [formName, setFormName] = useState("");

  const { data: bargainingUnits = [], isLoading } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { siriusId: string; name: string; data?: any }) => {
      return apiRequest("POST", "/api/bargaining-units", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Bargaining unit created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create bargaining unit.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/bargaining-units/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Bargaining unit deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete bargaining unit.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormSiriusId("");
    setFormName("");
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
            <h1 className="text-2xl font-bold text-foreground" data-testid="heading-bargaining-units">
              Bargaining Units
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage bargaining units and their configurations
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-bargaining-unit">
            <Plus className="mr-2 h-4 w-4" />
            Add Bargaining Unit
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Bargaining Unit List
            </CardTitle>
            <CardDescription>
              {bargainingUnits.length} {bargainingUnits.length === 1 ? "bargaining unit" : "bargaining units"} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bargainingUnits.length === 0 ? (
              <div className="text-center py-12">
                <Users className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium text-foreground">No bargaining units</h3>
                <p className="mt-2 text-muted-foreground">
                  Get started by creating a new bargaining unit.
                </p>
                <Button
                  onClick={() => setIsAddDialogOpen(true)}
                  className="mt-4"
                  data-testid="button-create-first-bargaining-unit"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create Bargaining Unit
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sirius ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bargainingUnits.map((unit) => (
                    <TableRow key={unit.id} data-testid={`row-bargaining-unit-${unit.id}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-bargaining-unit-sirius-id-${unit.id}`}>
                        {unit.siriusId}
                      </TableCell>
                      <TableCell data-testid={`text-bargaining-unit-name-${unit.id}`}>
                        {unit.name}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/bargaining-units/${unit.id}`}>
                            <Button variant="ghost" size="icon" data-testid={`button-view-bargaining-unit-${unit.id}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(unit.id)}
                            data-testid={`button-delete-bargaining-unit-${unit.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Bargaining Unit</DialogTitle>
            <DialogDescription>
              Create a new bargaining unit with a unique Sirius ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sirius-id">Sirius ID *</Label>
              <Input
                id="sirius-id"
                placeholder="e.g., bu-001"
                value={formSiriusId}
                onChange={(e) => setFormSiriusId(e.target.value)}
                data-testid="input-bargaining-unit-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Local 123"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-bargaining-unit-name"
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
              data-testid="button-confirm-add"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bargaining Unit</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this bargaining unit? This action cannot be undone.
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
