import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { TrustProvider } from "@shared/schema";

export default function TrustProviderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");

  const { data: provider, isLoading, error } = useQuery<TrustProvider>({
    queryKey: ["/api/trust/provider", id],
    queryFn: async () => {
      const response = await fetch(`/api/trust/provider/${id}`);
      if (!response.ok) {
        throw new Error("Trust provider not found");
      }
      return response.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      return apiRequest("PATCH", `/api/trust/provider/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust/provider", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust/providers"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Trust provider updated successfully!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update trust provider.",
        variant: "destructive",
      });
    },
  });

  const handleEditClick = () => {
    if (provider) {
      setEditName(provider.name);
      setIsEditing(true);
    }
  };

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
    setIsEditing(false);
    setEditName("");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error || !provider) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Trust Provider Not Found</CardTitle>
              <Link href="/trust/providers">
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Providers
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The trust provider you're looking for doesn't exist or has been removed.
            </p>
            <Link href="/trust/providers">
              <Button className="mt-4" data-testid="button-return">
                Return to Providers
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <Link href="/trust/providers">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Providers
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{provider.name}</CardTitle>
              <CardDescription>Trust Provider Details</CardDescription>
            </div>
            {!isEditing && (
              <Button onClick={handleEditClick} data-testid="button-edit">
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
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
                  {isEditing ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="mt-1"
                      data-testid="input-edit-name"
                    />
                  ) : (
                    <p className="text-sm mt-1" data-testid="text-provider-name">
                      {provider.name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {!!provider.data && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Additional Data</h3>
                <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto" data-testid="text-provider-data">
                  {JSON.stringify(provider.data, null, 2) as string}
                </pre>
              </div>
            )}

            {isEditing && (
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
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
