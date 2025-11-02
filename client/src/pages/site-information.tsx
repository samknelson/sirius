import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Save } from "lucide-react";

interface SiteSettings {
  siteName: string;
}

export default function SiteInformation() {
  const { toast } = useToast();
  const [siteName, setSiteName] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const { data: settings, isLoading } = useQuery<SiteSettings>({
    queryKey: ["/api/site-settings"],
  });

  // Update local state when settings are loaded
  if (settings && siteName === "" && !isEditing) {
    setSiteName(settings.siteName);
  }

  const updateMutation = useMutation({
    mutationFn: async (newSiteName: string) => {
      const res = await apiRequest("PUT", "/api/site-settings", { siteName: newSiteName });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/site-settings"] });
      setIsEditing(false);
      toast({
        title: "Settings saved",
        description: "Site name has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update site settings.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!siteName.trim()) {
      toast({
        title: "Validation error",
        description: "Site name cannot be empty.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate(siteName);
  };

  const handleCancel = () => {
    setSiteName(settings?.siteName || "");
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6" data-testid="heading-site-information">
        Site Information
      </h1>
      
      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>
            Configure basic information about your site
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="site-name">Site Name</Label>
            {isEditing ? (
              <div className="space-y-2">
                <Input
                  id="site-name"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Enter site name"
                  data-testid="input-site-name"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    data-testid="button-save"
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  className="px-3 py-2 bg-muted rounded-md"
                  data-testid="text-site-name"
                >
                  {settings?.siteName}
                </div>
                <Button
                  onClick={() => setIsEditing(true)}
                  data-testid="button-edit"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
