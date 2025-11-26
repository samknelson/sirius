import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Save } from "lucide-react";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";

interface SiteSettings {
  siteName: string;
  footer: string;
}

export default function SiteInformation() {
  const { toast } = useToast();
  const [siteName, setSiteName] = useState("");
  const [footer, setFooter] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingFooter, setIsEditingFooter] = useState(false);

  const { data: settings, isLoading } = useQuery<SiteSettings>({
    queryKey: ["/api/site-settings"],
  });

  // Update local state when settings are loaded
  useEffect(() => {
    if (settings && !isEditingName && !isEditingFooter) {
      setSiteName(settings.siteName);
      setFooter(settings.footer || "");
    }
  }, [settings, isEditingName, isEditingFooter]);

  const updateMutation = useMutation({
    mutationFn: async (updates: { siteName?: string; footer?: string }) => {
      return await apiRequest("PUT", "/api/site-settings", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/site-settings"] });
      setIsEditingName(false);
      setIsEditingFooter(false);
      toast({
        title: "Settings saved",
        description: "Site settings have been updated successfully.",
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

  const handleSaveName = () => {
    if (!siteName.trim()) {
      toast({
        title: "Validation error",
        description: "Site name cannot be empty.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({ siteName });
  };

  const handleSaveFooter = () => {
    updateMutation.mutate({ footer });
  };

  const handleCancelName = () => {
    setSiteName(settings?.siteName || "");
    setIsEditingName(false);
  };

  const handleCancelFooter = () => {
    setFooter(settings?.footer || "");
    setIsEditingFooter(false);
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
            {isEditingName ? (
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
                    onClick={handleSaveName}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-name"
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
                    onClick={handleCancelName}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-name"
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
                  onClick={() => setIsEditingName(true)}
                  data-testid="button-edit-name"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Footer</CardTitle>
          <CardDescription>
            Customize the footer HTML displayed on all pages
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Footer Content (HTML)</Label>
            {isEditingFooter ? (
              <div className="space-y-2">
                <SimpleHtmlEditor
                  value={footer}
                  onChange={setFooter}
                  placeholder="Enter footer content (supports HTML formatting)"
                  data-testid="editor-footer"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveFooter}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-footer"
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
                    onClick={handleCancelFooter}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-footer"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  className="px-3 py-2 bg-muted rounded-md min-h-[120px] prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: footer || '<em class="text-muted-foreground">No footer content set</em>' }}
                  data-testid="text-footer"
                />
                <Button
                  onClick={() => setIsEditingFooter(true)}
                  data-testid="button-edit-footer"
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
