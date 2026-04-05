import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TrustProviderEdiLayout, useTrustProviderEdiLayout } from "@/components/layouts/TrustProviderEdiLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import type { SftpClientDestination } from "@shared/schema/system/sftp-client-schema";

function EdiEditContent() {
  const { edi } = useTrustProviderEdiLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [formData, setFormData] = useState({
    name: "",
    siriusId: "",
    sftpClientId: "",
    active: true,
  });

  const { data: sftpDestinations } = useQuery<SftpClientDestination[]>({
    queryKey: ["/api/sftp/client-destinations"],
  });

  useEffect(() => {
    if (edi) {
      setFormData({
        name: edi.name,
        siriusId: edi.siriusId || "",
        sftpClientId: edi.sftpClientId || "",
        active: edi.active,
      });
    }
  }, [edi]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        active: data.active,
      };
      payload.siriusId = data.siriusId || null;
      payload.sftpClientId = data.sftpClientId || null;
      return apiRequest("PATCH", `/api/trust-provider-edi/${edi.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-edi"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-edi", edi.id] });
      toast({ title: "EDI record updated", description: "The EDI record has been updated." });
      setLocation(`/trust/provider-edi/${edi.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update EDI record", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    updateMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-edi-edit">
        <CardHeader>
          <CardTitle>Edit EDI Record</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                data-testid="input-edi-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siriusId">Sirius ID</Label>
              <Input
                id="siriusId"
                value={formData.siriusId}
                onChange={(e) => setFormData((prev) => ({ ...prev, siriusId: e.target.value }))}
                placeholder="Optional unique identifier"
                data-testid="input-edi-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sftpClientId">SFTP Destination</Label>
              <Select
                value={formData.sftpClientId || "none"}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, sftpClientId: value === "none" ? "" : value }))}
              >
                <SelectTrigger data-testid="select-edi-sftp">
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
            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, active: checked }))}
                data-testid="switch-edi-active"
              />
              <Label htmlFor="active">Active</Label>
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !formData.name}
                data-testid="button-edi-save"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/trust/provider-edi/${edi.id}`)}
                data-testid="button-edi-cancel-edit"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TrustProviderEdiEditPage() {
  return (
    <TrustProviderEdiLayout activeTab="edit">
      <EdiEditContent />
    </TrustProviderEdiLayout>
  );
}
