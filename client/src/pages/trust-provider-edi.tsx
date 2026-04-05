import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, FileText, Plus, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { TrustProviderEdi } from "@shared/schema/trust/provider-edi-schema";
import type { SftpClientDestination } from "@shared/schema/system/sftp-client-schema";

function TrustProviderEdiContent() {
  const { provider } = useTrustProviderLayout();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    siriusId: "",
    sftpClientId: "",
    active: true,
  });

  const { data: ediRecords, isLoading } = useQuery<TrustProviderEdi[]>({
    queryKey: ["/api/trust-provider-edi", { providerId: provider?.id }],
    queryFn: async () => {
      const response = await fetch(`/api/trust-provider-edi?providerId=${provider!.id}`);
      if (!response.ok) throw new Error("Failed to fetch EDI records");
      return response.json();
    },
    enabled: !!provider,
  });

  const { data: sftpDestinations } = useQuery<SftpClientDestination[]>({
    queryKey: ["/api/sftp/client-destinations"],
    enabled: isAdding,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        providerId: provider!.id,
        active: data.active,
      };
      if (data.siriusId) payload.siriusId = data.siriusId;
      if (data.sftpClientId) payload.sftpClientId = data.sftpClientId;
      return apiRequest("POST", "/api/trust-provider-edi", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-edi"] });
      toast({ title: "EDI record created", description: "The EDI record has been created." });
      setFormData({ name: "", siriusId: "", sftpClientId: "", active: true });
      setIsAdding(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create EDI record", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle data-testid="heading-edi-list">EDI Records</CardTitle>
          <Button
            size="sm"
            onClick={() => setIsAdding(!isAdding)}
            data-testid="button-add-edi"
          >
            <Plus size={16} className="mr-2" />
            {isAdding ? "Cancel" : "New EDI"}
          </Button>
        </CardHeader>
        <CardContent>
          {isAdding && (
            <Card className="mb-6 bg-muted/50">
              <CardHeader>
                <CardTitle className="text-lg">New EDI Record</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="edi-name">Name *</Label>
                      <Input
                        id="edi-name"
                        value={formData.name}
                        onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="EDI record name"
                        data-testid="input-new-edi-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edi-sirius-id">Sirius ID</Label>
                      <Input
                        id="edi-sirius-id"
                        value={formData.siriusId}
                        onChange={(e) => setFormData((prev) => ({ ...prev, siriusId: e.target.value }))}
                        placeholder="Optional unique identifier"
                        data-testid="input-new-edi-sirius-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edi-sftp">SFTP Destination</Label>
                      <Select
                        value={formData.sftpClientId || "none"}
                        onValueChange={(value) => setFormData((prev) => ({ ...prev, sftpClientId: value === "none" ? "" : value }))}
                      >
                        <SelectTrigger data-testid="select-new-edi-sftp">
                          <SelectValue placeholder="Select SFTP destination (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {sftpDestinations?.map((dest) => (
                            <SelectItem key={dest.id} value={dest.id}>
                              {dest.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center space-x-2 pt-6">
                      <Switch
                        id="edi-active"
                        checked={formData.active}
                        onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, active: checked }))}
                        data-testid="switch-new-edi-active"
                      />
                      <Label htmlFor="edi-active">Active</Label>
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setFormData({ name: "", siriusId: "", sftpClientId: "", active: true });
                        setIsAdding(false);
                      }}
                      data-testid="button-cancel-add-edi"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending || !formData.name}
                      data-testid="button-submit-edi"
                    >
                      {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create EDI
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border rounded-lg p-4">
                  <Skeleton className="h-6 w-48 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ))}
            </div>
          ) : !ediRecords || ediRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-edi-empty">
              <FileText size={48} className="mx-auto mb-4 opacity-50" />
              <p>No EDI records found for this provider.</p>
              <p className="text-sm mt-2">Click "New EDI" to create one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {ediRecords.map((edi) => (
                <Card key={edi.id} className="hover:shadow-md transition-shadow" data-testid={`card-edi-${edi.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-lg" data-testid={`text-edi-name-${edi.id}`}>
                            {edi.name}
                          </h3>
                          <Badge variant={edi.active ? "default" : "secondary"} data-testid={`badge-edi-status-${edi.id}`}>
                            {edi.active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          {edi.siriusId && (
                            <p data-testid={`text-edi-sirius-id-${edi.id}`}>
                              Sirius ID: <span className="font-medium">{edi.siriusId}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link href={`/trust/provider-edi/${edi.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-view-edi-${edi.id}`}
                          >
                            <Eye size={16} className="mr-2" />
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TrustProviderEdiPage() {
  return (
    <TrustProviderLayout activeTab="edi">
      <TrustProviderEdiContent />
    </TrustProviderLayout>
  );
}
