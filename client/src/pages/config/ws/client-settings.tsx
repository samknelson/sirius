import { useMemo, useState } from "react";
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
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Shield, Network } from "lucide-react";
import { WsClientLayout, useWsClientLayout } from "@/components/layouts/WsClientLayout";
import {
  useWsServiceConfigs,
  useWsClientGrants,
  useWsServicePlugins,
  wsServiceLabel,
  wsServiceAddress,
} from "./use-ws-services";

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

/**
 * Which web services this client may call. A grant is independent of the
 * client's credentials: adding or revoking one never rotates a key.
 */
function GrantsCard() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: configs = [], isLoading: configsLoading } = useWsServiceConfigs();
  const { data: plugins = [] } = useWsServicePlugins();
  const { data: grants = [], isLoading: grantsLoading } = useWsClientGrants(params.id);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const grantedIds = useMemo(() => new Set(grants.map((g) => g.configId)), [grants]);
  const pluginName = (pluginId: string) =>
    plugins.find((p) => p.id === pluginId)?.name || pluginId;

  const saveMutation = useMutation({
    mutationFn: (configIds: string[]) =>
      apiRequest("PUT", `/api/admin/ws-clients/${params.id}/grants`, { configIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients", params.id, "grants"] });
      toast({ title: "Access updated", description: "This client's web service access has been saved." });
      setIsEditOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update access",
        description: getApiErrorMessage(error, "An error occurred"),
        variant: "destructive",
      });
    },
  });

  // Seed the dialog during the opening render, not in an effect: an effect on
  // `open` lands after the portal body has already captured empty state.
  const openEditDialog = () => {
    setSelected(grants.map((g) => g.configId));
    setIsEditOpen(true);
  };

  const toggle = (configId: string, checked: boolean) => {
    setSelected((prev) =>
      checked ? Array.from(new Set([...prev, configId])) : prev.filter((id) => id !== configId),
    );
  };

  const granted = configs.filter((c) => grantedIds.has(c.id));

  return (
    <>
      <Card data-testid="card-grants">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Web Service Access
            </CardTitle>
            <CardDescription>
              The individual web services this client is allowed to call
            </CardDescription>
          </div>
          <Button onClick={openEditDialog} disabled={configsLoading} data-testid="button-edit-grants">
            Edit Access
          </Button>
        </CardHeader>
        <CardContent>
          {grantsLoading || configsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" data-testid="loader-grants" />
            </div>
          ) : granted.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4" data-testid="text-no-grants">
              This client cannot call any web service yet.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="list-grants">
              {granted.map((config) => (
                <li key={config.id} className="flex items-start justify-between gap-4" data-testid={`grant-${config.id}`}>
                  <div>
                    <div className="font-medium">{wsServiceLabel(config)}</div>
                    <div className="text-sm text-muted-foreground">
                      {pluginName(config.pluginId)} &middot; <code>/api/ws/{wsServiceAddress(config)}/…</code>
                    </div>
                  </div>
                  {!config.enabled && (
                    <Badge variant="outline" data-testid={`badge-disabled-${config.id}`}>
                      Disabled
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent data-testid="dialog-edit-grants">
          <DialogHeader>
            <DialogTitle>Web Service Access</DialogTitle>
          </DialogHeader>
          {configs.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="text-no-services">
              No web services are configured yet.
            </p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {configs.map((config) => (
                <label
                  key={config.id}
                  className="flex items-start gap-3 cursor-pointer"
                  data-testid={`option-service-${config.id}`}
                >
                  <Checkbox
                    checked={selected.includes(config.id)}
                    onCheckedChange={(checked) => toggle(config.id, checked === true)}
                    data-testid={`checkbox-service-${config.id}`}
                  />
                  <span>
                    <span className="font-medium">{wsServiceLabel(config)}</span>
                    {!config.enabled && (
                      <Badge variant="outline" className="ml-2">
                        Disabled
                      </Badge>
                    )}
                    <span className="block text-sm text-muted-foreground">
                      {pluginName(config.pluginId)} &middot; <code>/api/ws/{wsServiceAddress(config)}/…</code>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} data-testid="button-cancel-grants">
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate(selected)}
              disabled={saveMutation.isPending}
              data-testid="button-save-grants"
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettingsContent() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { client } = useWsClientLayout();

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
      toast({ title: "Failed to update client", description: getApiErrorMessage(error, "An error occurred"), variant: "destructive" });
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

      <GrantsCard />
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
