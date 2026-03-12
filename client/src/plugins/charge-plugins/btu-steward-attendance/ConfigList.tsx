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
    amount?: number;
    eventTypeIds?: string[];
    attendedStatuses?: string[];
  };
}

interface EventType {
  id: string;
  name: string;
  category: string;
}

export default function BtuStewardAttendanceConfigList({ pluginId }: ChargePluginConfigProps) {
  const { toast } = useToast();

  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfig[]>({
    queryKey: ["/api/charge-plugin-configs/by-plugin", pluginId],
    queryFn: async () => {
      const response = await fetch(`/api/charge-plugin-configs/by-plugin/${pluginId}`);
      if (!response.ok) throw new Error("Failed to fetch configurations");
      return response.json();
    },
  });

  const { data: accounts = [] } = useQuery<LedgerAccountBase[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/options/event-type"],
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PUT", `/api/charge-plugin-configs/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs/by-plugin", pluginId] });
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
      return apiRequest("DELETE", `/api/charge-plugin-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs/by-plugin", pluginId] });
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

  const getAccountName = (accountId?: string) => {
    if (!accountId) return "Not set";
    const account = accounts.find(a => a.id === accountId);
    return account ? account.name : accountId;
  };

  const getEventTypeNames = (eventTypeIds?: string[]) => {
    if (!eventTypeIds || eventTypeIds.length === 0) return "None configured";
    return eventTypeIds.map(id => {
      const eventType = eventTypes.find(et => et.id === id);
      return eventType ? eventType.name : id;
    }).join(", ");
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
          <h1 className="text-3xl font-bold" data-testid="text-page-title">BTU Steward Attendance Configurations</h1>
          <p className="text-muted-foreground mt-2">
            Award points to shop stewards when they attend configured event types
          </p>
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
          <CardTitle>Global Configuration</CardTitle>
          <CardDescription>
            Default configuration for awarding attendance points to stewards
          </CardDescription>
        </CardHeader>
        <CardContent>
          {globalConfig ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 p-4 border rounded-md flex-wrap">
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
                    <p><strong>Account:</strong> {getAccountName(globalConfig.settings.accountId)}</p>
                    <p><strong>Points per Attendance:</strong> {globalConfig.settings.amount ?? "Not set"}</p>
                    <p><strong>Event Types:</strong> {getEventTypeNames(globalConfig.settings.eventTypeIds)}</p>
                    <p><strong>Attended Statuses:</strong> {globalConfig.settings.attendedStatuses?.join(", ") || "Not set"}</p>
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
