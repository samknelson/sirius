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
import { PluginConfigModal } from "@/components/dispatch/PluginConfigModal";
import type { EligibilityPluginMetadata, EligibilityPluginConfig, JobTypeData } from "@shared/schema";

function DispatchJobTypePluginsContent() {
  const { jobType } = useDispatchJobTypeLayout();
  const { toast } = useToast();
  
  const jobTypeData = jobType.data as JobTypeData | undefined;
  const eligibility = jobTypeData?.eligibility || [];
  
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<EligibilityPluginMetadata | null>(null);

  const { data: eligibilityPlugins = [], isLoading: pluginsLoading } = useQuery<EligibilityPluginMetadata[]>({
    queryKey: ["/api/dispatch-eligibility-plugins"],
  });

  const saveEligibilityMutation = useMutation({
    mutationFn: async (newEligibility: EligibilityPluginConfig[]) => {
      const updatedData: JobTypeData = {
        ...jobTypeData,
        eligibility: newEligibility,
      };
      return apiRequest("PUT", `/api/options/dispatch-job-type/${jobType.id}`, {
        name: jobType.name,
        description: jobType.description,
        data: updatedData,
      });
    },
    onMutate: async (newEligibility) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/options/dispatch-job-type", jobType.id] });
      
      // Snapshot current value for rollback
      const previousJobType = queryClient.getQueryData(["/api/options/dispatch-job-type", jobType.id]);
      
      // Optimistically update the cache
      queryClient.setQueryData(["/api/options/dispatch-job-type", jobType.id], (old: typeof jobType | undefined) => {
        if (!old) return old;
        const oldData = (old.data || {}) as JobTypeData;
        return {
          ...old,
          data: {
            ...oldData,
            eligibility: newEligibility,
          },
        };
      });
      
      return { previousJobType };
    },
    onError: (error: any, _newEligibility, context) => {
      // Rollback on error
      if (context?.previousJobType) {
        queryClient.setQueryData(["/api/options/dispatch-job-type", jobType.id], context.previousJobType);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to save plugin configuration.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Always refetch after mutation completes
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type", jobType.id] });
    },
  });

  const togglePluginEnabled = (pluginId: string) => {
    const existing = eligibility.find(p => p.pluginId === pluginId);
    let newEligibility: EligibilityPluginConfig[];
    
    if (existing) {
      newEligibility = eligibility.map(p => 
        p.pluginId === pluginId ? { ...p, enabled: !p.enabled } : p
      );
    } else {
      newEligibility = [...eligibility, { pluginId, enabled: true, config: {} }];
    }
    
    saveEligibilityMutation.mutate(newEligibility);
  };

  const isPluginEnabled = (pluginId: string): boolean => {
    const config = eligibility.find(p => p.pluginId === pluginId);
    return config?.enabled ?? false;
  };

  const getPluginConfig = (pluginId: string): EligibilityPluginConfig["config"] => {
    const config = eligibility.find(p => p.pluginId === pluginId);
    return config?.config || {};
  };

  const openConfigModal = (plugin: EligibilityPluginMetadata) => {
    setSelectedPlugin(plugin);
    setConfigModalOpen(true);
  };

  const handleSavePluginConfig = (newConfig: EligibilityPluginConfig["config"]) => {
    if (!selectedPlugin) return;
    
    const existing = eligibility.find(p => p.pluginId === selectedPlugin.id);
    let newEligibility: EligibilityPluginConfig[];
    
    if (existing) {
      newEligibility = eligibility.map(p => 
        p.pluginId === selectedPlugin.id ? { ...p, config: newConfig } : p
      );
    } else {
      newEligibility = [...eligibility, { pluginId: selectedPlugin.id, enabled: false, config: newConfig }];
    }
    
    saveEligibilityMutation.mutate(newEligibility, {
      onSuccess: () => {
        setConfigModalOpen(false);
        toast({
          title: "Success",
          description: "Plugin configuration saved.",
        });
      },
    });
  };

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
        {pluginsLoading ? (
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
              const hasConfigFields = plugin.configFields && plugin.configFields.length > 0;
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
                      disabled={saveEligibilityMutation.isPending}
                      data-testid={`switch-plugin-${plugin.id}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {selectedPlugin && (
        <PluginConfigModal
          open={configModalOpen}
          onOpenChange={setConfigModalOpen}
          plugin={selectedPlugin}
          currentConfig={getPluginConfig(selectedPlugin.id)}
          onSave={handleSavePluginConfig}
          isSaving={saveEligibilityMutation.isPending}
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
