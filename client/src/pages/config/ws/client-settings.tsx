import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Shield } from "lucide-react";
import { WsClientLayout, useWsClientLayout } from "@/components/layouts/WsClientLayout";

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

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

function SettingsContent() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { client, bundle } = useWsClientLayout();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    status: "active" as string,
    ipAllowlistEnabled: false,
  });

  const updateClientMutation = useMutation({
    mutationFn: (data: typeof editForm) => apiRequest("PATCH", `/api/admin/ws-clients/${params.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients"] });
      toast({ title: "Client updated", description: "Settings have been saved." });
      setIsEditOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to update client", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const openEditDialog = () => {
    setEditForm({
      name: client.name,
      description: client.description || "",
      status: client.status,
      ipAllowlistEnabled: client.ipAllowlistEnabled,
    });
    setIsEditOpen(true);
  };

  return (
    <>
      <Card data-testid="card-settings">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Client Settings</CardTitle>
            <CardDescription>Basic information and access control</CardDescription>
          </div>
          <Button onClick={openEditDialog} data-testid="button-edit-settings">
            Edit
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">Bundle</Label>
              <p className="font-medium" data-testid="text-bundle">
                {bundle?.name || client.bundleId}
              </p>
            </div>
            <div>
              <Label className="text-muted-foreground">Status</Label>
              <p data-testid="text-status">
                <StatusBadge status={client.status} />
              </p>
            </div>
            <div>
              <Label className="text-muted-foreground">IP Allowlist</Label>
              <p data-testid="text-ip-allowlist">
                {client.ipAllowlistEnabled ? (
                  <Badge variant="outline" className="gap-1">
                    <Shield className="h-3 w-3" />
                    Enabled
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">Disabled</span>
                )}
              </p>
            </div>
            <div>
              <Label className="text-muted-foreground">Created</Label>
              <p className="text-sm" data-testid="text-created">
                {formatDate(client.createdAt as unknown as string)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent data-testid="dialog-edit-client">
          <DialogHeader>
            <DialogTitle>Edit Client Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editForm.description}
                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                data-testid="input-edit-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, status: value }))}
              >
                <SelectTrigger id="edit-status" data-testid="select-edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>IP Allowlist</Label>
                <p className="text-sm text-muted-foreground">
                  Restrict access to specific IP addresses
                </p>
              </div>
              <Switch
                checked={editForm.ipAllowlistEnabled}
                onCheckedChange={(checked) => setEditForm((prev) => ({ ...prev, ipAllowlistEnabled: checked }))}
                data-testid="switch-ip-allowlist"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button onClick={() => updateClientMutation.mutate(editForm)} disabled={updateClientMutation.isPending} data-testid="button-save-settings">
              {updateClientMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WsClientSettingsPage() {
  return (
    <WsClientLayout activeTab="settings">
      <SettingsContent />
    </WsClientLayout>
  );
}
