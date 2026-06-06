import { pluginManifestQueryKey } from "@/plugins/_core";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { usePageTitle } from "@/contexts/PageTitleContext";
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
  account: string | null;
  name: string | null;
  settings: Record<string, any>;
}

interface ChargePluginState {
  pluginId: string;
  enabled: boolean;
}

export default function ChargePluginsListPage() {
  usePageTitle("Charge Plugins");
  const { toast } = useToast();

  // Fetch all registered plugins
  const { data: plugins = [], isLoading: isLoadingPlugins } = useQuery<ChargePluginMetadata[]>({
    queryKey: pluginManifestQueryKey("charge"),
  });

  // Fetch all plugin configurations
  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfig[]>({
    queryKey: ["/api/plugins/charge/configs"],
  });

  // Fetch all per-plugin master switch states. A plugin without a stored row
  // is enabled by default.
  const { data: states = [], isLoading: isLoadingStates } = useQuery<ChargePluginState[]>({
    queryKey: ["/api/plugins/charge/states"],
  });

  const toggleMasterMutation = useMutation({
    mutationFn: async ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) => {
      return apiRequest("PUT", `/api/plugins/charge/states/${pluginId}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/states"] });
      toast({
        title: "Success",
        description: "Plugin master switch updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update plugin master switch.",
        variant: "destructive",
      });
    },
  });

  const getConfigsForPlugin = (pluginId: string) => {
    return configs.filter(c => c.pluginId === pluginId);
  };

  // A plugin is master-enabled unless an explicit state row says otherwise.
  const isMasterEnabled = (pluginId: string) => {
    const state = states.find(s => s.pluginId === pluginId);
    return state ? state.enabled : true;
  };

  if (isLoadingPlugins || isLoadingConfigs || isLoadingStates) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Charge Plugins</h1>
        <p className="text-muted-foreground mt-2">
          Manage automatic charge plugins for ledger transactions. The master switch turns a
          plugin on or off. Turning it off only stops new charges from being created — existing
          ledger entries are left untouched.
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
            const isConfigured = pluginConfigs.length > 0;
            const masterEnabled = isMasterEnabled(plugin.id);

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
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Master:</span>
                        <Switch
                          checked={masterEnabled}
                          onCheckedChange={(enabled) =>
                            toggleMasterMutation.mutate({ pluginId: plugin.id, enabled })
                          }
                          data-testid={`switch-master-${plugin.id}`}
                        />
                        <span className={`text-sm ${masterEnabled ? "text-green-600 font-medium" : "text-muted-foreground"}`}>
                          {masterEnabled ? "ON" : "OFF"}
                        </span>
                      </div>
                      <Link href={`/config/ledger/charge-plugins/${plugin.id}`}>
                        <Button variant="default" data-testid={`button-configure-${plugin.id}`}>
                          <Settings className="mr-2 h-4 w-4" />
                          Configure
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
