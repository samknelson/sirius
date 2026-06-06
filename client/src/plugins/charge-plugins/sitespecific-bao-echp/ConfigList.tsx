import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Settings, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ChargePluginConfigProps } from "../registry";
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
import { LedgerAccountBase } from "@/lib/ledger-types";

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountId?: string;
    policyIds?: string[];
    breakpoints?: unknown[];
  };
}

export default function BaoEchpConfigList({ pluginId }: ChargePluginConfigProps) {
  const { toast } = useToast();

  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfig[]>({
    queryKey: ["/api/plugins/charge/configs/by-plugin", pluginId],
    queryFn: async () => {
      const response = await fetch(`/api/plugins/charge/configs/by-plugin/${pluginId}`);
      if (!response.ok) throw new Error("Failed to fetch configurations");
      return response.json();
    },
  });

  const { data: accounts = [] } = useQuery<LedgerAccountBase[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PUT", `/api/plugins/charge/configs/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs/by-plugin", pluginId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs"] });
      toast({
        title: "Success",
        description: "Configuration status updated.",
      });
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
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs/by-plugin", pluginId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs"] });
      toast({
        title: "Success",
        description: "Configuration deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete configuration.",
        variant: "destructive",
      });
    },
  });

  const globalConfig = configs.find(c => c.scope === "global");

  const breakpointCount = (config: ChargePluginConfig) => config.settings.breakpoints?.length ?? 0;

  const policyCount = (config: ChargePluginConfig) => config.settings.policyIds?.length ?? 0;

  const getAccountName = (accountId?: string) => {
    if (!accountId) return "Not set";
    const account = accounts.find(a => a.id === accountId);
    return account ? account.name : accountId;
  };

  if (isLoadingConfigs) {
    return (
      <div className="p-8">
        <p>Loading configurations...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">Event Center Hours Purchase Charge Configurations</h1>
          <p className="text-muted-foreground mt-2">
            Manage the account that worker ECHP charges are posted to
          </p>
        </div>
        {!globalConfig && (
          <Link href={`/config/ledger/charge-plugins/${pluginId}/new`}>
            <Button data-testid="button-new-config">
              <Plus className="mr-2 h-4 w-4" />
              New Configuration
            </Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Global Configuration</CardTitle>
          <CardDescription>
            Default configuration applied when an ECHP hours entry is saved
          </CardDescription>
        </CardHeader>
        <CardContent>
          {globalConfig ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-md">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={globalConfig.enabled}
                      onCheckedChange={(checked) =>
                        toggleEnabledMutation.mutate({ id: globalConfig.id, enabled: checked })
                      }
                      data-testid="switch-enabled-global"
                    />
                    <Badge variant={globalConfig.enabled ? "default" : "secondary"}>
                      {globalConfig.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <p data-testid="text-config-account"><strong>Account:</strong> {getAccountName(globalConfig.settings.accountId)}</p>
                    <p data-testid="text-config-pricing">
                      <strong>Pricing:</strong> {policyCount(globalConfig)} {policyCount(globalConfig) === 1 ? "policy" : "policies"} enabled, {breakpointCount(globalConfig)} {breakpointCount(globalConfig) === 1 ? "breakpoint" : "breakpoints"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/config/ledger/charge-plugins/${pluginId}/edit/${globalConfig.id}`}>
                    <Button variant="outline" size="sm" data-testid="button-edit-global">
                      <Settings className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  </Link>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" data-testid="button-delete-global">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Configuration</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this global configuration? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(globalConfig.id)}
                          data-testid="button-confirm-delete"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No global configuration</p>
              <Link href={`/config/ledger/charge-plugins/${pluginId}/new`}>
                <Button variant="outline" className="mt-4" data-testid="button-create-global">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Global Configuration
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
