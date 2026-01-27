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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Key, Eye, Trash2, Shield } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { WsClient, WsBundle } from "@shared/schema";

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    suspended: "secondary",
    revoked: "destructive",
  };
  return (
    <Badge variant={variants[status] || "outline"} data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}

interface ClientWithBundle extends WsClient {
  bundle?: WsBundle;
}

export default function WsClientsPage() {
  usePageTitle("Web Service Clients");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WsClient | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    bundleId: "",
    status: "active" as const,
    ipAllowlistEnabled: false,
  });

  const { data: clients = [], isLoading: clientsLoading, error: clientsError } = useQuery<ClientWithBundle[]>({
    queryKey: ["/api/admin/ws-clients"],
  });

  const { data: bundles = [] } = useQuery<WsBundle[]>({
    queryKey: ["/api/admin/ws-bundles"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => apiRequest("POST", "/api/admin/ws-clients", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients"] });
      toast({ title: "Client created", description: "The new client has been created successfully." });
      setIsCreateOpen(false);
      setFormData({ name: "", description: "", bundleId: "", status: "active", ipAllowlistEnabled: false });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create client", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/ws-clients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients"] });
      toast({ title: "Client deleted", description: "The client has been deleted." });
      setDeleteTarget(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete client", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!formData.name || !formData.bundleId) {
      toast({ title: "Validation error", description: "Name and bundle are required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  if (clientsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-clients" />
      </div>
    );
  }

  if (clientsError) {
    return (
      <Alert variant="destructive" data-testid="alert-error">
        <AlertDescription>Failed to load clients. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const getBundleName = (bundleId: string) => {
    const bundle = bundles.find((b) => b.id === bundleId);
    return bundle?.name || bundleId;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-ws-clients">
            Web Service Clients
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage external clients that can access your web service APIs
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-client">
          <Plus className="h-4 w-4 mr-2" />
          Create Client
        </Button>
      </div>

      <Card data-testid="card-clients">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Clients
          </CardTitle>
          <CardDescription>
            {clients.length} client{clients.length !== 1 ? "s" : ""} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-clients">
              No clients configured. Create a client to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Bundle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IP Allowlist</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id} data-testid={`row-client-${client.id}`}>
                    <TableCell>
                      <div>
                        <div className="font-medium" data-testid={`text-client-name-${client.id}`}>
                          {client.name}
                        </div>
                        {client.description && (
                          <div className="text-sm text-muted-foreground">
                            {client.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-client-bundle-${client.id}`}>
                      {getBundleName(client.bundleId)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={client.status} />
                    </TableCell>
                    <TableCell>
                      {client.ipAllowlistEnabled ? (
                        <Badge variant="outline" className="gap-1">
                          <Shield className="h-3 w-3" />
                          Enabled
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Disabled</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link href={`/config/ws/clients/${client.id}`}>
                          <Button variant="ghost" size="icon" data-testid={`button-view-${client.id}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(client)}
                          data-testid={`button-delete-${client.id}`}
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
        <DialogContent data-testid="dialog-create-client">
          <DialogHeader>
            <DialogTitle>Create Client</DialogTitle>
            <DialogDescription>
              Create a new external client that can access your web service APIs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="My External System"
                data-testid="input-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description of this client"
                data-testid="input-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bundle">Bundle</Label>
              <Select
                value={formData.bundleId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, bundleId: value }))}
              >
                <SelectTrigger id="bundle" data-testid="select-bundle">
                  <SelectValue placeholder="Select a bundle" />
                </SelectTrigger>
                <SelectContent>
                  {bundles.map((bundle) => (
                    <SelectItem key={bundle.id} value={bundle.id} data-testid={`option-bundle-${bundle.id}`}>
                      {bundle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !formData.name || !formData.bundleId}
              data-testid="button-submit"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent data-testid="dialog-delete-client">
          <DialogHeader>
            <DialogTitle>Delete Client</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This will also delete all associated credentials and IP rules. This action cannot be undone.
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
