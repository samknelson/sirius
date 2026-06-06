import { pluginManifestQueryKey } from "@/plugins/_core";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Settings, Trash2, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Employer } from "@/lib/employer-types";
import { LedgerAccountBase } from "@/lib/ledger-types";
import { chargePluginUIRegistry, type ChargePluginConfigRow } from "@/plugins/charge-plugins/registry";

interface ChargePluginMetadata {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  defaultScope: "global" | "employer";
}

export default function ChargePluginsListPage() {
  usePageTitle("Charge Plugins");
  const { toast } = useToast();

  const { data: plugins = [], isLoading: isLoadingPlugins } = useQuery<ChargePluginMetadata[]>({
    queryKey: pluginManifestQueryKey("charge"),
  });

  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfigRow[]>({
    queryKey: ["/api/plugins/charge/configs"],
  });

  const { data: accounts = [] } = useQuery<LedgerAccountBase[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PUT", `/api/plugins/charge/configs/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs"] });
      toast({ title: "Success", description: "Configuration status updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update configuration status.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/plugins/charge/configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs"] });
      toast({ title: "Success", description: "Configuration deleted." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete configuration.",
        variant: "destructive",
      });
    },
  });

  const getAccountName = (accountId?: string | null) => {
    if (!accountId) return "Not set";
    const account = accounts.find((a) => a.id === accountId);
    return account ? account.name : accountId;
  };

  const getScopeLabel = (config: ChargePluginConfigRow) => {
    if (config.scope === "employer") {
      const employer = employers.find((e) => e.id === config.employerId);
      return employer?.name || config.employerId || "Employer";
    }
    if (config.scope === "batch") return "Batch";
    return "Global";
  };

  if (isLoadingPlugins || isLoadingConfigs) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  const sortedPlugins = [...plugins].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="text-page-title">
            Charge Plugins
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage all automatic charge configurations in one place, grouped by
            plugin type. Enable or disable a configuration to control whether new
            charges are created.
          </p>
        </div>
        {sortedPlugins.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="button-new-config">
                <Plus className="mr-2 h-4 w-4" />
                New Configuration
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {sortedPlugins.map((plugin) => (
                <Link key={plugin.id} href={`/config/ledger/charge-plugins/${plugin.id}/new`}>
                  <DropdownMenuItem data-testid={`menu-new-${plugin.id}`}>
                    {plugin.name}
                  </DropdownMenuItem>
                </Link>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {sortedPlugins.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">No charge plugins available.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedPlugins.map((plugin) => {
            const pluginConfigs = configs.filter((c) => c.pluginId === plugin.id);
            const SummaryComponent = chargePluginUIRegistry.get(plugin.id)?.summaryComponent;

            return (
              <Card key={plugin.id} data-testid={`card-plugin-${plugin.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1">
                      <CardTitle data-testid={`text-plugin-name-${plugin.id}`}>{plugin.name}</CardTitle>
                      <CardDescription className="mt-2">{plugin.description}</CardDescription>
                    </div>
                    <Badge variant="secondary" className="text-xs" data-testid={`badge-count-${plugin.id}`}>
                      {pluginConfigs.length} configuration{pluginConfigs.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {pluginConfigs.length > 0 ? (
                    <div className="space-y-3" data-testid={`list-configs-${plugin.id}`}>
                      {pluginConfigs.map((config) => (
                        <div
                          key={config.id}
                          className="flex items-center justify-between gap-4 p-4 border rounded-md flex-wrap"
                          data-testid={`row-config-${config.id}`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={config.enabled}
                                onCheckedChange={(checked) =>
                                  toggleEnabledMutation.mutate({ id: config.id, enabled: checked })
                                }
                                data-testid={`switch-enabled-${config.id}`}
                              />
                              <Badge variant={config.enabled ? "default" : "secondary"}>
                                {config.enabled ? "Enabled" : "Disabled"}
                              </Badge>
                              <Badge variant="outline" data-testid={`badge-scope-${config.id}`}>
                                {getScopeLabel(config)}
                              </Badge>
                            </div>
                            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                              <p data-testid={`text-config-name-${config.id}`}>
                                <strong>Name:</strong> {config.name || "—"}
                              </p>
                              <p data-testid={`text-config-account-${config.id}`}>
                                <strong>Account:</strong> {getAccountName(config.account)}
                              </p>
                              {SummaryComponent && <SummaryComponent config={config} />}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Link href={`/config/ledger/charge-plugins/${plugin.id}/edit/${config.id}`}>
                              <Button variant="outline" size="sm" data-testid={`button-edit-${config.id}`}>
                                <Settings className="mr-2 h-4 w-4" />
                                Edit
                              </Button>
                            </Link>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" data-testid={`button-delete-${config.id}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Configuration</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete this configuration? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteMutation.mutate(config.id)}
                                    data-testid={`button-confirm-delete-${config.id}`}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <p className="text-sm text-muted-foreground" data-testid={`text-empty-${plugin.id}`}>
                        No configurations yet.
                      </p>
                      <Link href={`/config/ledger/charge-plugins/${plugin.id}/new`}>
                        <Button variant="outline" size="sm" data-testid={`button-add-${plugin.id}`}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Configuration
                        </Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
