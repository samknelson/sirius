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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Shield, Trash2, Network } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { WsClientLayout, useWsClientLayout } from "@/components/layouts/WsClientLayout";
import type { WsClientIpRule } from "@shared/schema";

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function IpRulesContent() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { client } = useWsClientLayout();

  const [isCreateIpOpen, setIsCreateIpOpen] = useState(false);
  const [deleteIpTarget, setDeleteIpTarget] = useState<WsClientIpRule | null>(null);
  const [ipForm, setIpForm] = useState({ ipAddress: "", description: "" });

  const { data: ipRules = [], isLoading: ipRulesLoading } = useQuery<WsClientIpRule[]>({
    queryKey: ["/api/admin/ws-clients", params.id, "ip-rules"],
    enabled: !!params.id,
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

  return (
    <>
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

      <Dialog open={isCreateIpOpen} onOpenChange={setIsCreateIpOpen}>
        <DialogContent data-testid="dialog-create-ip-rule">
          <DialogHeader>
            <DialogTitle>Add IP Address</DialogTitle>
            <DialogDescription>
              Add an IP address or CIDR range to the allowlist.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ip-address">IP Address or CIDR</Label>
              <Input
                id="ip-address"
                value={ipForm.ipAddress}
                onChange={(e) => setIpForm((prev) => ({ ...prev, ipAddress: e.target.value }))}
                placeholder="e.g., 192.168.1.1 or 10.0.0.0/8"
                data-testid="input-ip-address"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ip-description">Description (optional)</Label>
              <Textarea
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
              data-testid="button-create-ip-submit"
            >
              {createIpRuleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteIpTarget} onOpenChange={() => setDeleteIpTarget(null)}>
        <DialogContent data-testid="dialog-delete-ip-rule">
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
    </>
  );
}

export default function WsClientIpRulesPage() {
  return (
    <WsClientLayout activeTab="ip-rules">
      <IpRulesContent />
    </WsClientLayout>
  );
}
