import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { SftpClientLayout, useSftpClientLayout } from "@/components/layouts/SftpClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

function EditContent() {
  const { destination } = useSftpClientLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [formData, setFormData] = useState({
    name: "",
    siriusId: "",
    description: "",
    active: true,
  });

  useEffect(() => {
    if (destination) {
      setFormData({
        name: destination.name,
        siriusId: destination.siriusId || "",
        description: destination.description || "",
        active: destination.active,
      });
    }
  }, [destination]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        active: data.active,
      };
      if (data.siriusId) {
        payload.siriusId = data.siriusId;
      } else {
        payload.siriusId = null;
      }
      if (data.description) {
        payload.description = data.description;
      } else {
        payload.description = null;
      }
      return apiRequest("PUT", `/api/sftp/client-destinations/${destination.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sftp/client-destinations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sftp/client-destinations", destination.id] });
      toast({ title: "Destination updated", description: "The SFTP client destination has been updated." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update destination", description: error?.message || "An error occurred", variant: "destructive" });
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
      <Card data-testid="card-edit">
        <CardHeader>
          <CardTitle>Edit Destination</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siriusId">Sirius ID</Label>
              <Input
                id="siriusId"
                value={formData.siriusId}
                onChange={(e) => setFormData((prev) => ({ ...prev, siriusId: e.target.value }))}
                placeholder="Optional unique identifier"
                data-testid="input-edit-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description"
                data-testid="input-edit-description"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, active: checked }))}
                data-testid="switch-edit-active"
              />
              <Label htmlFor="active">Active</Label>
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !formData.name}
                data-testid="button-save"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/config/sftp/client/${destination.id}`)}
                data-testid="button-cancel-edit"
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

export default function SftpClientEditPage() {
  return (
    <SftpClientLayout activeTab="edit">
      <EditContent />
    </SftpClientLayout>
  );
}
