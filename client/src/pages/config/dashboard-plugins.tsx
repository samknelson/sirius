import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Puzzle, Info, Settings } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getAllPlugins } from "@/plugins/registry";
import { PluginConfig } from "@/plugins/types";

export default function DashboardPluginsConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const allPlugins = getAllPlugins();

  const { data: pluginConfigs = [], isLoading } = useQuery<PluginConfig[]>({
    queryKey: ["/api/dashboard-plugins/config"],
  });

  const [localStates, setLocalStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Initialize local states from configs or defaults
    const states: Record<string, boolean> = {};
    allPlugins.forEach(plugin => {
      const config = pluginConfigs.find(c => c.pluginId === plugin.id);
      states[plugin.id] = config ? config.enabled : plugin.enabledByDefault;
    });
    setLocalStates(states);
  }, [pluginConfigs]);

  const updatePluginMutation = useMutation({
    mutationFn: async ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) => {
      return apiRequest("PUT", `/api/dashboard-plugins/config/${pluginId}`, { enabled });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-plugins/config"] });
      toast({
        title: "Plugin Updated",
        description: `Plugin ${variables.enabled ? "enabled" : "disabled"} successfully.`,
      });
    },
    onError: (error: any, variables) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update plugin.",
        variant: "destructive",
      });
      // Revert local state on error
      setLocalStates(prev => ({
        ...prev,
        [variables.pluginId]: !variables.enabled,
      }));
    },
  });

  const handleToggle = (pluginId: string, enabled: boolean) => {
    // Optimistic update
    setLocalStates(prev => ({
      ...prev,
      [pluginId]: enabled,
    }));
    
    updatePluginMutation.mutate({ pluginId, enabled });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard Plugins
          </h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Dashboard Plugins
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure which plugins appear on the dashboard for all users.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Plugins can be enabled or disabled globally. Individual permissions may still apply to each plugin.
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        {allPlugins.map((plugin) => (
          <Card key={plugin.id} data-testid={`card-plugin-${plugin.id}`}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Puzzle className="h-5 w-5" />
                  {plugin.name}
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`plugin-${plugin.id}`} className="text-sm font-normal">
                    {localStates[plugin.id] ? "Enabled" : "Disabled"}
                  </Label>
                  <Switch
                    id={`plugin-${plugin.id}`}
                    checked={localStates[plugin.id] || false}
                    onCheckedChange={(checked) => handleToggle(plugin.id, checked)}
                    data-testid={`switch-plugin-${plugin.id}`}
                  />
                </div>
              </CardTitle>
              <CardDescription>{plugin.description}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <div>
                <span className="font-medium">Order:</span> {plugin.order}
              </div>
              {plugin.requiredPermissions && plugin.requiredPermissions.length > 0 && (
                <div>
                  <span className="font-medium">Required Permissions:</span>{" "}
                  {plugin.requiredPermissions.join(", ")}
                </div>
              )}
              {plugin.settingsComponent && (
                <div className="pt-2">
                  <Link href={`/config/dashboard-plugins/${plugin.id}`}>
                    <Button variant="outline" size="sm" data-testid={`button-settings-${plugin.id}`}>
                      <Settings className="h-4 w-4 mr-2" />
                      Configure Settings
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {allPlugins.length === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No plugins are registered. Add plugins to the registry to see them here.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
