import { pluginManifestQueryKey, pluginSearch, pluginConfigsUrl } from "@/plugins/_core";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DispatchJobTypeLayout, useDispatchJobTypeLayout } from "@/components/layouts/DispatchJobTypeLayout";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Shield, Settings } from "lucide-react";
import { SchemaFormDialog } from "@/components/json-schema-form";
import type { EligibilityPluginMetadata } from "@shared/schema";

/** True when the plugin schema declares at least one configurable property. */
function hasConfigProps(schema: EligibilityPluginMetadata["configSchema"]): boolean {
  if (!schema) return false;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  return !!props && Object.keys(props).length > 0;
}

/**
 * Flat (hydrated) dispatch-eligibility config envelope returned by
 * `pluginSearch`. `data` is the plugin's per-job-type config; `jobType` is the
 * subsidiary dimension. `id` is the unified `plugin_configs` row id used to
 * PATCH/DELETE this entry.
 */
interface DispatchConfigRow {
  id: string;
  pluginId: string;
  enabled: boolean;
  data: Record<string, unknown> | null;
  jobType: string | null;
}

type SaveArgs =
  | { op: "create"; body: Record<string, unknown> }
  | { op: "update"; id: string; body: Record<string, unknown> };

function DispatchJobTypePluginsContent() {
  const { jobType } = useDispatchJobTypeLayout();
  const { toast } = useToast();

  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<EligibilityPluginMetadata | null>(null);

  const { data: eligibilityPlugins = [], isLoading: pluginsLoading } = useQuery<EligibilityPluginMetadata[]>({
    queryKey: pluginManifestQueryKey("dispatch-eligibility"),
  });

  // Eligibility entries for this job type now live in the unified plugin_configs
  // table; load every dispatch-eligibility row scoped to this job type.
  const configsQueryKey = ["/api/plugins/dispatch-eligibility/configs/search", jobType.id] as const;
  const { data: configRows = [], isLoading: rowsLoading } = useQuery<DispatchConfigRow[]>({
    queryKey: configsQueryKey,
    queryFn: () =>
      pluginSearch<"dispatch-eligibility", DispatchConfigRow>("dispatch-eligibility", {
        jobType: jobType.id,
      }),
  });

  const rowByPlugin = new Map<string, DispatchConfigRow>();
  for (const row of configRows) {
    rowByPlugin.set(row.pluginId, row);
  }

  const saveMutation = useMutation({
    mutationFn: async (args: SaveArgs) => {
      const baseUrl = pluginConfigsUrl("dispatch-eligibility");
      return args.op === "create"
        ? apiRequest("POST", baseUrl, args.body)
        : apiRequest("PATCH", `${baseUrl}/${args.id}`, args.body);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save plugin configuration.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: configsQueryKey });
    },
  });

  const togglePluginEnabled = (pluginId: string) => {
    const existing = rowByPlugin.get(pluginId);
    if (existing) {
      saveMutation.mutate({ op: "update", id: existing.id, body: { enabled: !existing.enabled } });
    } else {
      saveMutation.mutate({
        op: "create",
        body: { pluginId, enabled: true, data: {}, jobType: jobType.id },
      });
    }
  };

  const isPluginEnabled = (pluginId: string): boolean => {
    return rowByPlugin.get(pluginId)?.enabled ?? false;
  };

  const getPluginConfig = (pluginId: string): Record<string, unknown> => {
    return (rowByPlugin.get(pluginId)?.data ?? {}) as Record<string, unknown>;
  };

  const openConfigModal = (plugin: EligibilityPluginMetadata) => {
    setSelectedPlugin(plugin);
    setConfigModalOpen(true);
  };

  const handleSavePluginConfig = (newConfig: Record<string, unknown>) => {
    if (!selectedPlugin) return;

    const existing = rowByPlugin.get(selectedPlugin.id);
    const onSuccess = () => {
      setConfigModalOpen(false);
      toast({
        title: "Success",
        description: "Plugin configuration saved.",
      });
    };

    if (existing) {
      saveMutation.mutate({ op: "update", id: existing.id, body: { data: newConfig } }, { onSuccess });
    } else {
      saveMutation.mutate(
        {
          op: "create",
          body: { pluginId: selectedPlugin.id, enabled: false, data: newConfig, jobType: jobType.id },
        },
        { onSuccess },
      );
    }
  };

  const isLoading = pluginsLoading || rowsLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" data-testid="title-plugins">
          <Shield className="h-5 w-5" />
          Eligibility Plugins
        </CardTitle>
        <CardDescription>
          Configure which eligibility criteria apply to jobs of this type.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : eligibilityPlugins.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No eligibility plugins available.
          </p>
        ) : (
          <div className="space-y-4">
            {eligibilityPlugins.map((plugin) => {
              const hasConfigFields = hasConfigProps(plugin.configSchema);
              return (
                <div 
                  key={plugin.id} 
                  className="flex items-center justify-between p-4 border rounded-md"
                  data-testid={`row-plugin-${plugin.id}`}
                >
                  <div className="space-y-1 flex-1">
                    <Label htmlFor={`plugin-${plugin.id}`} className="font-medium">
                      {plugin.name}
                    </Label>
                    {plugin.description && (
                      <p className="text-sm text-muted-foreground">{plugin.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {hasConfigFields && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openConfigModal(plugin)}
                        data-testid={`button-configure-${plugin.id}`}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    )}
                    <Switch
                      id={`plugin-${plugin.id}`}
                      checked={isPluginEnabled(plugin.id)}
                      onCheckedChange={() => togglePluginEnabled(plugin.id)}
                      disabled={saveMutation.isPending}
                      data-testid={`switch-plugin-${plugin.id}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {selectedPlugin && selectedPlugin.configSchema && (
        <SchemaFormDialog
          open={configModalOpen}
          onOpenChange={setConfigModalOpen}
          title={selectedPlugin.name}
          description={selectedPlugin.description}
          schema={selectedPlugin.configSchema}
          initialData={getPluginConfig(selectedPlugin.id)}
          onSave={(data) => handleSavePluginConfig(data as Record<string, unknown>)}
          isSaving={saveMutation.isPending}
          testId={`dialog-plugin-${selectedPlugin.id}`}
        />
      )}
    </Card>
  );
}

export default function DispatchJobTypePluginsPage() {
  usePageTitle("Job Type Plugins");
  return (
    <DispatchJobTypeLayout activeTab="plugins">
      <DispatchJobTypePluginsContent />
    </DispatchJobTypeLayout>
  );
}
