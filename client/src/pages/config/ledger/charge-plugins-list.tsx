import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings } from "lucide-react";
import { Link } from "wouter";

interface ChargePluginMetadata {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  defaultScope: "global" | "employer";
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: Record<string, any>;
}

export default function ChargePluginsListPage() {
  const { toast } = useToast();

  // Fetch all registered plugins
  const { data: plugins = [], isLoading: isLoadingPlugins } = useQuery<ChargePluginMetadata[]>({
    queryKey: ["/api/charge-plugins"],
  });

  // Fetch all plugin configurations
  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfig[]>({
    queryKey: ["/api/charge-plugin-configs"],
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PUT", `/api/charge-plugin-configs/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs"] });
      toast({
        title: "Success",
        description: "Plugin status updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update plugin status.",
        variant: "destructive",
      });
    },
  });

  const getConfigsForPlugin = (pluginId: string) => {
    return configs.filter(c => c.pluginId === pluginId);
  };

  const getGlobalConfig = (pluginId: string) => {
    return configs.find(c => c.pluginId === pluginId && c.scope === "global");
  };

  if (isLoadingPlugins || isLoadingConfigs) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Charge Plugins</h1>
        <p className="text-muted-foreground mt-2">
          Manage automatic charge plugins for ledger transactions
        </p>
      </div>

      {plugins.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">No charge plugins available.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {plugins.map((plugin) => {
            const pluginConfigs = getConfigsForPlugin(plugin.id);
            const globalConfig = getGlobalConfig(plugin.id);
            const employerConfigCount = pluginConfigs.filter(c => c.scope === "employer").length;
            const isConfigured = pluginConfigs.length > 0;
            
            return (
              <Card key={plugin.id} data-testid={`card-plugin-${plugin.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle>{plugin.name}</CardTitle>
                      <CardDescription className="mt-2">{plugin.description}</CardDescription>
                      <div className="flex gap-2 mt-3">
                        <Badge variant="outline" className="text-xs">
                          Scope: {plugin.defaultScope}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          Triggers: {plugin.triggers.join(", ")}
                        </Badge>
                        {isConfigured && (
                          <Badge variant="default" className="text-xs">
                            {pluginConfigs.length} configuration{pluginConfigs.length !== 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {globalConfig && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">Global:</span>
                          <Switch
                            checked={globalConfig.enabled}
                            onCheckedChange={(enabled) => 
                              toggleEnabledMutation.mutate({ id: globalConfig.id, enabled })
                            }
                            data-testid={`switch-enabled-${plugin.id}`}
                          />
                          <span className={`text-sm ${globalConfig.enabled ? "text-green-600 font-medium" : "text-muted-foreground"}`}>
                            {globalConfig.enabled ? "ON" : "OFF"}
                          </span>
                        </div>
                      )}
                      <Link href={`/config/ledger/charge-plugins/${plugin.id}`}>
                        <Button variant="default" data-testid={`button-configure-${plugin.id}`}>
                          <Settings className="mr-2 h-4 w-4" />
                          Configure
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardHeader>
                {employerConfigCount > 0 && (
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {employerConfigCount} employer-specific configuration{employerConfigCount !== 1 ? "s" : ""} configured
                    </p>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
