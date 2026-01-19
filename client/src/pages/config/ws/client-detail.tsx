import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Key, Shield, ArrowLeft, Copy, Check, Trash2, Ban, Settings, Network } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { WsClient, WsBundle, WsClientCredential, WsClientIpRule } from "@shared/schema";

interface CredentialWithoutHash {
  id: string;
  clientId: string;
  clientKey: string;
  label: string | null;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface NewCredentialResponse {
  id: string;
  clientKey: string;
  clientSecret: string;
  label: string | null;
  expiresAt: string | null;
  createdAt: string;
  message: string;
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

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

export default function WsClientDetailPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("settings");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCreateCredOpen, setIsCreateCredOpen] = useState(false);
  const [isCreateIpOpen, setIsCreateIpOpen] = useState(false);
  const [newCredential, setNewCredential] = useState<NewCredentialResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [deleteCredTarget, setDeleteCredTarget] = useState<CredentialWithoutHash | null>(null);
  const [deleteIpTarget, setDeleteIpTarget] = useState<WsClientIpRule | null>(null);

  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    status: "active" as string,
    ipAllowlistEnabled: false,
  });

  const [credForm, setCredForm] = useState({
    label: "",
  });

  const [ipForm, setIpForm] = useState({
    ipAddress: "",
    description: "",
  });

  const { data: client, isLoading: clientLoading, error: clientError } = useQuery<WsClient>({
    queryKey: ["/api/admin/ws-clients", params.id],
    enabled: !!params.id,
  });

  const { data: bundles = [] } = useQuery<WsBundle[]>({
    queryKey: ["/api/admin/ws-bundles"],
  });

  const { data: credentials = [], isLoading: credentialsLoading } = useQuery<CredentialWithoutHash[]>({
    queryKey: ["/api/admin/ws-clients", params.id, "credentials"],
    enabled: !!params.id,
  });

  const { data: ipRules = [], isLoading: ipRulesLoading } = useQuery<WsClientIpRule[]>({
    queryKey: ["/api/admin/ws-clients", params.id, "ip-rules"],
    enabled: !!params.id,
  });

  usePageTitle(client?.name || "Client Details");

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

  const createCredentialMutation = useMutation({
    mutationFn: (data: typeof credForm) => apiRequest("POST", `/api/admin/ws-clients/${params.id}/credentials`, data),
    onSuccess: (data: NewCredentialResponse) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients", params.id, "credentials"] });
      setNewCredential(data);
      setIsCreateCredOpen(false);
      setCredForm({ label: "" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create credential", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const deactivateCredentialMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/ws-credentials/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients", params.id, "credentials"] });
      toast({ title: "Credential deactivated", description: "The credential can no longer be used." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to deactivate credential", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/ws-credentials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients", params.id, "credentials"] });
      toast({ title: "Credential deleted" });
      setDeleteCredTarget(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete credential", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const createIpRuleMutation = useMutation({
    mutationFn: (data: typeof ipForm) => apiRequest("POST", `/api/admin/ws-clients/${params.id}/ip-rules`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients", params.id, "ip-rules"] });
      toast({ title: "IP rule created" });
      setIsCreateIpOpen(false);
      setIpForm({ ipAddress: "", description: "" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create IP rule", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const deleteIpRuleMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/ws-ip-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ws-clients", params.id, "ip-rules"] });
      toast({ title: "IP rule deleted" });
      setDeleteIpTarget(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete IP rule", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const openEditDialog = () => {
    if (client) {
      setEditForm({
        name: client.name,
        description: client.description || "",
        status: client.status,
        ipAllowlistEnabled: client.ipAllowlistEnabled,
      });
      setIsEditOpen(true);
    }
  };

  const copyToClipboard = async (text: string, type: "key" | "secret") => {
    await navigator.clipboard.writeText(text);
    if (type === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  };

  const getBundleName = (bundleId: string) => {
    const bundle = bundles.find((b) => b.id === bundleId);
    return bundle?.name || bundleId;
  };

  if (clientLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-client" />
      </div>
    );
  }

  if (clientError || !client) {
    return (
      <Alert variant="destructive" data-testid="alert-error">
        <AlertDescription>Failed to load client. The client may not exist.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/config/ws/clients")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold" data-testid="heading-client-name">
            {client.name}
          </h1>
          <p className="text-muted-foreground mt-1">
            {client.description || "No description"}
          </p>
        </div>
        <StatusBadge status={client.status} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-client">
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="credentials" data-testid="tab-credentials">
            <Key className="h-4 w-4 mr-2" />
            Credentials
          </TabsTrigger>
          <TabsTrigger value="ip-rules" data-testid="tab-ip-rules">
            <Shield className="h-4 w-4 mr-2" />
            IP Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-6">
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
                    {getBundleName(client.bundleId)}
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
        </TabsContent>

        <TabsContent value="credentials" className="mt-6">
          <Card data-testid="card-credentials">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  API Credentials
                </CardTitle>
                <CardDescription>
                  {credentials.length} credential{credentials.length !== 1 ? "s" : ""} configured
                </CardDescription>
              </div>
              <Button onClick={() => setIsCreateCredOpen(true)} data-testid="button-create-credential">
                <Plus className="h-4 w-4 mr-2" />
                Create Credential
              </Button>
            </CardHeader>
            <CardContent>
              {credentialsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : credentials.length === 0 ? (
                <p className="text-muted-foreground text-center py-8" data-testid="text-no-credentials">
                  No credentials configured. Create one to allow API access.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Client Key</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {credentials.map((cred) => (
                      <TableRow key={cred.id} data-testid={`row-credential-${cred.id}`}>
                        <TableCell data-testid={`text-cred-label-${cred.id}`}>
                          {cred.label || <span className="text-muted-foreground">No label</span>}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-2 py-1 rounded" data-testid={`text-cred-key-${cred.id}`}>
                            {cred.clientKey.slice(0, 8)}...
                          </code>
                        </TableCell>
                        <TableCell>
                          {cred.isActive ? (
                            <Badge variant="default">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-cred-used-${cred.id}`}>
                          {formatDate(cred.lastUsedAt)}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-cred-created-${cred.id}`}>
                          {formatDate(cred.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {cred.isActive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deactivateCredentialMutation.mutate(cred.id)}
                                disabled={deactivateCredentialMutation.isPending}
                                title="Deactivate"
                                data-testid={`button-deactivate-${cred.id}`}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteCredTarget(cred)}
                              data-testid={`button-delete-cred-${cred.id}`}
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
        </TabsContent>

        <TabsContent value="ip-rules" className="mt-6">
          <Card data-testid="card-ip-rules">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  IP Allowlist
                </CardTitle>
                <CardDescription>
                  {client.ipAllowlistEnabled
                    ? `${ipRules.length} IP rule${ipRules.length !== 1 ? "s" : ""} configured`
                    : "IP allowlisting is disabled for this client"}
                </CardDescription>
              </div>
              {client.ipAllowlistEnabled && (
                <Button onClick={() => setIsCreateIpOpen(true)} data-testid="button-create-ip-rule">
                  <Plus className="h-4 w-4 mr-2" />
                  Add IP
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!client.ipAllowlistEnabled ? (
                <Alert data-testid="alert-ip-disabled">
                  <Network className="h-4 w-4" />
                  <AlertDescription>
                    IP allowlisting is disabled. Enable it in Settings to restrict access by IP address.
                  </AlertDescription>
                </Alert>
              ) : ipRulesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : ipRules.length === 0 ? (
                <Alert variant="destructive" data-testid="alert-no-ips">
                  <AlertDescription>
                    No IP addresses configured. All requests will be blocked until you add at least one allowed IP.
                  </AlertDescription>
                </Alert>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ipRules.map((rule) => (
                      <TableRow key={rule.id} data-testid={`row-ip-${rule.id}`}>
                        <TableCell>
                          <code className="text-sm bg-muted px-2 py-1 rounded" data-testid={`text-ip-address-${rule.id}`}>
                            {rule.ipAddress}
                          </code>
                        </TableCell>
                        <TableCell data-testid={`text-ip-desc-${rule.id}`}>
                          {rule.description || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {rule.isActive ? (
                            <Badge variant="default">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-ip-created-${rule.id}`}>
                          {formatDate(rule.createdAt as unknown as string)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteIpTarget(rule)}
                            data-testid={`button-delete-ip-${rule.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
            <Button
              onClick={() => updateClientMutation.mutate(editForm)}
              disabled={updateClientMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateClientMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateCredOpen} onOpenChange={setIsCreateCredOpen}>
        <DialogContent data-testid="dialog-create-credential">
          <DialogHeader>
            <DialogTitle>Create API Credential</DialogTitle>
            <DialogDescription>
              Create a new client key and secret for API access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cred-label">Label (optional)</Label>
              <Input
                id="cred-label"
                value={credForm.label}
                onChange={(e) => setCredForm((prev) => ({ ...prev, label: e.target.value }))}
                placeholder="e.g., Production Key"
                data-testid="input-cred-label"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateCredOpen(false)} data-testid="button-cancel-cred">
              Cancel
            </Button>
            <Button
              onClick={() => createCredentialMutation.mutate(credForm)}
              disabled={createCredentialMutation.isPending}
              data-testid="button-create-cred"
            >
              {createCredentialMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newCredential} onOpenChange={() => setNewCredential(null)}>
        <DialogContent data-testid="dialog-new-credential">
          <DialogHeader>
            <DialogTitle>Credential Created</DialogTitle>
            <DialogDescription>
              Store these credentials securely. The secret cannot be retrieved again.
            </DialogDescription>
          </DialogHeader>
          {newCredential && (
            <div className="space-y-4">
              <Alert data-testid="alert-save-secret">
                <AlertDescription>
                  Copy both values now. The secret will not be shown again.
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label>Client Key</Label>
                <div className="flex gap-2">
                  <Input value={newCredential.clientKey} readOnly className="font-mono text-sm" data-testid="input-new-key" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(newCredential.clientKey, "key")}
                    data-testid="button-copy-key"
                  >
                    {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Client Secret</Label>
                <div className="flex gap-2">
                  <Input value={newCredential.clientSecret} readOnly className="font-mono text-sm" data-testid="input-new-secret" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(newCredential.clientSecret, "secret")}
                    data-testid="button-copy-secret"
                  >
                    {copiedSecret ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setNewCredential(null)} data-testid="button-done-cred">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateIpOpen} onOpenChange={setIsCreateIpOpen}>
        <DialogContent data-testid="dialog-create-ip">
          <DialogHeader>
            <DialogTitle>Add IP Address</DialogTitle>
            <DialogDescription>
              Add an IP address to the allowlist for this client.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ip-address">IP Address</Label>
              <Input
                id="ip-address"
                value={ipForm.ipAddress}
                onChange={(e) => setIpForm((prev) => ({ ...prev, ipAddress: e.target.value }))}
                placeholder="e.g., 192.168.1.1"
                data-testid="input-ip-address"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ip-description">Description (optional)</Label>
              <Input
                id="ip-description"
                value={ipForm.description}
                onChange={(e) => setIpForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="e.g., Office network"
                data-testid="input-ip-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateIpOpen(false)} data-testid="button-cancel-ip">
              Cancel
            </Button>
            <Button
              onClick={() => createIpRuleMutation.mutate(ipForm)}
              disabled={createIpRuleMutation.isPending || !ipForm.ipAddress}
              data-testid="button-create-ip"
            >
              {createIpRuleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteCredTarget} onOpenChange={() => setDeleteCredTarget(null)}>
        <DialogContent data-testid="dialog-delete-credential">
          <DialogHeader>
            <DialogTitle>Delete Credential</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this credential? API requests using this key will fail immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCredTarget(null)} data-testid="button-cancel-delete-cred">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteCredTarget && deleteCredentialMutation.mutate(deleteCredTarget.id)}
              disabled={deleteCredentialMutation.isPending}
              data-testid="button-confirm-delete-cred"
            >
              {deleteCredentialMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteIpTarget} onOpenChange={() => setDeleteIpTarget(null)}>
        <DialogContent data-testid="dialog-delete-ip">
          <DialogHeader>
            <DialogTitle>Delete IP Rule</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove "{deleteIpTarget?.ipAddress}" from the allowlist?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteIpTarget(null)} data-testid="button-cancel-delete-ip">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteIpTarget && deleteIpRuleMutation.mutate(deleteIpTarget.id)}
              disabled={deleteIpRuleMutation.isPending}
              data-testid="button-confirm-delete-ip"
            >
              {deleteIpRuleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
