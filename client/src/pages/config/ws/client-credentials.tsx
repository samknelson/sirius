import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Key, Copy, Check, Trash2, Ban } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { WsClientLayout } from "@/components/layouts/WsClientLayout";

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

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function CredentialsContent() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isCreateCredOpen, setIsCreateCredOpen] = useState(false);
  const [newCredential, setNewCredential] = useState<NewCredentialResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [deleteCredTarget, setDeleteCredTarget] = useState<CredentialWithoutHash | null>(null);
  const [credForm, setCredForm] = useState({ label: "" });

  const { data: credentials = [], isLoading: credentialsLoading } = useQuery<CredentialWithoutHash[]>({
    queryKey: ["/api/admin/ws-clients", params.id, "credentials"],
    enabled: !!params.id,
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

  return (
    <>
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

      <Dialog open={isCreateCredOpen} onOpenChange={setIsCreateCredOpen}>
        <DialogContent data-testid="dialog-create-credential">
          <DialogHeader>
            <DialogTitle>Create Credential</DialogTitle>
            <DialogDescription>
              Create a new API credential. The secret will only be shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cred-label">Label (optional)</Label>
              <Input
                id="cred-label"
                value={credForm.label}
                onChange={(e) => setCredForm({ label: e.target.value })}
                placeholder="e.g., Production API Key"
                data-testid="input-cred-label"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateCredOpen(false)} data-testid="button-cancel-cred">
              Cancel
            </Button>
            <Button onClick={() => createCredentialMutation.mutate(credForm)} disabled={createCredentialMutation.isPending} data-testid="button-create-cred-submit">
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
              Save these credentials now. The secret will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertDescription>
              Store these credentials securely. The secret cannot be retrieved after you close this dialog.
            </AlertDescription>
          </Alert>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Client Key</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted p-2 rounded text-sm break-all" data-testid="text-new-client-key">
                  {newCredential?.clientKey}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(newCredential?.clientKey || "", "key")}
                  data-testid="button-copy-key"
                >
                  {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Client Secret</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted p-2 rounded text-sm break-all" data-testid="text-new-client-secret">
                  {newCredential?.clientSecret}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(newCredential?.clientSecret || "", "secret")}
                  data-testid="button-copy-secret"
                >
                  {copiedSecret ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewCredential(null)} data-testid="button-close-new-cred">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteCredTarget} onOpenChange={() => setDeleteCredTarget(null)}>
        <DialogContent data-testid="dialog-delete-credential">
          <DialogHeader>
            <DialogTitle>Delete Credential</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this credential? This action cannot be undone.
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
    </>
  );
}

export default function WsClientCredentialsPage() {
  return (
    <WsClientLayout activeTab="credentials">
      <CredentialsContent />
    </WsClientLayout>
  );
}
