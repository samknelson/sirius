import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Eye, Trash2, Server } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { SftpClientDestination } from "@shared/schema/system/sftp-client-schema";

export default function SftpClientsPage() {
  usePageTitle("SFTP Client Destinations");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SftpClientDestination | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    siriusId: "",
    active: true,
  });

  const { data: destinations = [], isLoading, error } = useQuery<SftpClientDestination[]>({
    queryKey: ["/api/sftp/client-destinations"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        active: data.active,
      };
      if (data.siriusId) payload.siriusId = data.siriusId;
      if (data.description) payload.description = data.description;
      return apiRequest("POST", "/api/sftp/client-destinations", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sftp/client-destinations"] });
      toast({ title: "Destination created", description: "The new SFTP client destination has been created." });
      setIsCreateOpen(false);
      setFormData({ name: "", description: "", siriusId: "", active: true });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create destination", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/sftp/client-destinations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sftp/client-destinations"] });
      toast({ title: "Destination deleted", description: "The destination has been deleted." });
      setDeleteTarget(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete destination", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!formData.name) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-sftp-clients" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" data-testid="alert-error">
        <AlertDescription>Failed to load SFTP client destinations. Please try again.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-sftp-clients">
            SFTP Client Destinations
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage SFTP client destinations for file transfer
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-destination">
          <Plus className="h-4 w-4 mr-2" />
          Create Destination
        </Button>
      </div>

      <Card data-testid="card-destinations">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Destinations
          </CardTitle>
          <CardDescription>
            {destinations.length} destination{destinations.length !== 1 ? "s" : ""} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          {destinations.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-destinations">
              No destinations configured. Create a destination to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {destinations.map((dest) => (
                  <TableRow key={dest.id} data-testid={`row-destination-${dest.id}`}>
                    <TableCell>
                      <div>
                        <div className="font-medium" data-testid={`text-destination-name-${dest.id}`}>
                          {dest.name}
                        </div>
                        {dest.description && (
                          <div className="text-sm text-muted-foreground">
                            {dest.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-destination-sirius-id-${dest.id}`}>
                      {dest.siriusId || <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={dest.active ? "default" : "secondary"} data-testid={`badge-active-${dest.id}`}>
                        {dest.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link href={`/config/sftp/client/${dest.id}`}>
                          <Button variant="ghost" size="icon" data-testid={`button-view-${dest.id}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(dest)}
                          data-testid={`button-delete-${dest.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
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

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent data-testid="dialog-create-destination">
          <DialogHeader>
            <DialogTitle>Create SFTP Client Destination</DialogTitle>
            <DialogDescription>
              Add a new SFTP client destination for file transfer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="My SFTP Destination"
                data-testid="input-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siriusId">Sirius ID (optional)</Label>
              <Input
                id="siriusId"
                value={formData.siriusId}
                onChange={(e) => setFormData((prev) => ({ ...prev, siriusId: e.target.value }))}
                placeholder="Optional unique identifier"
                data-testid="input-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description"
                data-testid="input-description"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, active: checked }))}
                data-testid="switch-active"
              />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !formData.name}
              data-testid="button-submit"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent data-testid="dialog-delete-destination">
          <DialogHeader>
            <DialogTitle>Delete Destination</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
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
