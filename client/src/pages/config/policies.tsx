import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Plus, Loader2, Trash2, Eye } from "lucide-react";
import { Policy } from "@shared/schema";
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
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function PoliciesConfigPage() {
  usePageTitle("Employer Policies");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [formSiriusId, setFormSiriusId] = useState("");
  const [formName, setFormName] = useState("");

  const { data: policies = [], isLoading } = useQuery<Policy[]>({
    queryKey: ["/api/policies"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { siriusId: string; name?: string; data?: any }) => {
      return apiRequest("POST", "/api/policies", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Policy created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create policy.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Policy deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete policy.",
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

    createMutation.mutate({
      siriusId: formSiriusId.trim(),
      name: formName.trim() || undefined,
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
            <h1 className="text-2xl font-bold text-foreground" data-testid="heading-policies">
              Policies
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage system policies and their configurations
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-policy">
            <Plus className="mr-2 h-4 w-4" />
            Add Policy
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Policy List
            </CardTitle>
            <CardDescription>
              {policies.length} {policies.length === 1 ? "policy" : "policies"} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {policies.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium text-foreground">No policies</h3>
                <p className="mt-2 text-muted-foreground">
                  Get started by creating a new policy.
                </p>
                <Button
                  onClick={() => setIsAddDialogOpen(true)}
                  className="mt-4"
                  data-testid="button-create-first-policy"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create Policy
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
                  {policies.map((policy) => (
                    <TableRow key={policy.id} data-testid={`row-policy-${policy.id}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-policy-sirius-id-${policy.id}`}>
                        {policy.siriusId}
                      </TableCell>
                      <TableCell data-testid={`text-policy-name-${policy.id}`}>
                        {policy.name || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/policies/${policy.id}`}>
                            <Button variant="ghost" size="icon" data-testid={`button-view-policy-${policy.id}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(policy.id)}
                            data-testid={`button-delete-policy-${policy.id}`}
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
            <DialogTitle>Add Policy</DialogTitle>
            <DialogDescription>
              Create a new policy with a unique Sirius ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sirius-id">Sirius ID *</Label>
              <Input
                id="sirius-id"
                placeholder="e.g., policy-001"
                value={formSiriusId}
                onChange={(e) => setFormSiriusId(e.target.value)}
                data-testid="input-policy-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Main Policy"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-policy-name"
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
            <DialogTitle>Delete Policy</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this policy? This action cannot be undone.
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
