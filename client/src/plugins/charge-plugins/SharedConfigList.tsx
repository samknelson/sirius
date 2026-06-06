import { ReactNode } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Settings, Trash2 } from "lucide-react";
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
import { Employer } from "@/lib/employer-types";
import { LedgerAccountBase } from "@/lib/ledger-types";

export interface ChargePluginConfigRow<TSettings = Record<string, unknown>> {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  account: string | null;
  name: string | null;
  settings: TSettings;
}

interface SharedConfigListProps<TSettings = Record<string, unknown>> {
  pluginId: string;
  title: string;
  description?: string;
  /** Description shown on the configurations card. */
  cardDescription?: string;
  /** Message shown when no configurations exist. */
  emptyMessage?: string;
  /** Optional plugin-specific detail lines rendered under Name/Account. */
  renderSummary?: (config: ChargePluginConfigRow<TSettings>) => ReactNode;
}

export default function SharedConfigList<TSettings = Record<string, unknown>>({
  pluginId,
  title,
  description,
  cardDescription,
  emptyMessage,
  renderSummary,
}: SharedConfigListProps<TSettings>) {
  const { toast } = useToast();

  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfigRow<TSettings>[]>({
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

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PUT", `/api/plugins/charge/configs/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs/by-plugin", pluginId] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs/by-plugin", pluginId] });
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

  const getScopeLabel = (config: ChargePluginConfigRow<TSettings>) => {
    if (config.scope === "employer") {
      const employer = employers.find((e) => e.id === config.employerId);
      return employer?.name || config.employerId || "Employer";
    }
    if (config.scope === "batch") return "Batch";
    return "Global";
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">{title}</h1>
          {description && <p className="text-muted-foreground mt-2">{description}</p>}
        </div>
        <Link href={`/config/ledger/charge-plugins/${pluginId}/new`}>
          <Button data-testid="button-new-config">
            <Plus className="mr-2 h-4 w-4" />
            New Configuration
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configurations</CardTitle>
          {cardDescription && <CardDescription>{cardDescription}</CardDescription>}
        </CardHeader>
        <CardContent>
          {configs.length > 0 ? (
            <div className="space-y-3" data-testid="list-configs">
              {configs.map((config) => (
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
                      {renderSummary?.(config)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/config/ledger/charge-plugins/${pluginId}/edit/${config.id}`}>
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
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                {emptyMessage || "No configurations yet."}
              </p>
              <Link href={`/config/ledger/charge-plugins/${pluginId}/new`}>
                <Button variant="outline" data-testid="button-create-first">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Configuration
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
