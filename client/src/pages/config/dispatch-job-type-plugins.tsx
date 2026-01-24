import { useState, useEffect } from "react";
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
  const [formEligibility, setFormEligibility] = useState<EligibilityPluginConfig[]>(
    jobTypeData?.eligibility || []
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<EligibilityPluginMetadata | null>(null);

  const { data: eligibilityPlugins = [], isLoading: pluginsLoading } = useQuery<EligibilityPluginMetadata[]>({
    queryKey: ["/api/dispatch-eligibility-plugins"],
  });

  useEffect(() => {
    setFormEligibility(jobTypeData?.eligibility || []);
    setHasChanges(false);
  }, [jobTypeData]);

  const togglePluginEnabled = (pluginId: string) => {
    setFormEligibility(prev => {
      const existing = prev.find(p => p.pluginId === pluginId);
      if (existing) {
        return prev.map(p => p.pluginId === pluginId ? { ...p, enabled: !p.enabled } : p);
      }
      return [...prev, { pluginId, enabled: true, config: {} }];
    });
    setHasChanges(true);
  };

  const isPluginEnabled = (pluginId: string): boolean => {
    const config = formEligibility.find(p => p.pluginId === pluginId);
    return config?.enabled ?? false;
  };

  const getPluginConfig = (pluginId: string): EligibilityPluginConfig["config"] => {
    const config = formEligibility.find(p => p.pluginId === pluginId);
    return config?.config || {};
  };

  const openConfigModal = (plugin: EligibilityPluginMetadata) => {
    setSelectedPlugin(plugin);
    setConfigModalOpen(true);
  };

  const handleSavePluginConfig = (newConfig: EligibilityPluginConfig["config"]) => {
    if (!selectedPlugin) return;
    
    setFormEligibility(prev => {
      const existing = prev.find(p => p.pluginId === selectedPlugin.id);
      if (existing) {
        return prev.map(p => p.pluginId === selectedPlugin.id ? { ...p, config: newConfig } : p);
      }
      return [...prev, { pluginId: selectedPlugin.id, enabled: false, config: newConfig }];
    });
    setHasChanges(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updatedData: JobTypeData = {
        ...jobTypeData,
        eligibility: formEligibility,
      };
      return apiRequest("PUT", `/api/options/dispatch-job-type/${jobType.id}`, {
        name: jobType.name,
        description: jobType.description,
        data: updatedData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type", jobType.id] });
      setHasChanges(false);
      toast({
        title: "Success",
        description: "Plugin configuration saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save plugin configuration.",
        variant: "destructive",
      });
    },
  });

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
                      data-testid={`switch-plugin-${plugin.id}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 pt-4 border-t">
          <Button 
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
            data-testid="button-save"
          >
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          {hasChanges && (
            <Button 
              variant="ghost" 
              onClick={() => {
                setFormEligibility(jobTypeData?.eligibility || []);
                setHasChanges(false);
              }}
              data-testid="button-reset"
            >
              Reset
            </Button>
          )}
        </div>
      </CardContent>

      {selectedPlugin && (
        <PluginConfigModal
          open={configModalOpen}
          onOpenChange={setConfigModalOpen}
          plugin={selectedPlugin}
          currentConfig={getPluginConfig(selectedPlugin.id)}
          onSave={handleSavePluginConfig}
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
