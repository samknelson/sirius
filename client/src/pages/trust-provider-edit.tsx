import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Save, X } from "lucide-react";
import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

function TrustProviderEditContent() {
  const { id } = useParams<{ id: string }>();
  const { provider } = useTrustProviderLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [editName, setEditName] = useState(provider?.name || "");

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      return apiRequest("PATCH", `/api/trust/provider/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust/provider", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust/providers"] });
      toast({
        title: "Success",
        description: "Trust provider updated successfully!",
      });
      setLocation(`/trust/provider/${id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update trust provider.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!editName.trim()) {
      toast({
        title: "Validation Error",
        description: "Provider name is required.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({ name: editName.trim() });
  };

  const handleCancel = () => {
    setLocation(`/trust/provider/${id}`);
  };

  if (!provider) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit Provider</CardTitle>
        <CardDescription>Update trust provider information</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Basic Information</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Provider ID</label>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-provider-id">
                  {provider.id}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1"
                  data-testid="input-edit-name"
                  placeholder="Enter provider name"
                />
              </div>
            </div>
          </div>

          {!!provider.data && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Additional Data</h3>
              <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto" data-testid="text-provider-data">
                {JSON.stringify(provider.data, null, 2) as string}
              </pre>
              <p className="text-xs text-muted-foreground mt-2">
                Note: Additional data cannot be edited from this interface.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={updateMutation.isPending}
              data-testid="button-cancel"
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              data-testid="button-save"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TrustProviderEditPage() {
  return (
    <TrustProviderLayout activeTab="edit">
      <TrustProviderEditContent />
    </TrustProviderLayout>
  );
}
