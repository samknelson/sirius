import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface ChargePluginMetadata {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  defaultScope: "global" | "employer";
  settingsSchema?: any;
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: Record<string, any>;
}

interface Employer {
  id: string;
  name: string;
  isActive: boolean;
}

export default function ChargePluginsPage() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState("");
  const [selectedScope, setSelectedScope] = useState<"global" | "employer">("global");
  const [selectedEmployerId, setSelectedEmployerId] = useState("");
  const [settingsJson, setSettingsJson] = useState("{}");
  const [settingsError, setSettingsError] = useState("");

  // Fetch all registered plugins
  const { data: plugins = [], isLoading: isLoadingPlugins } = useQuery<ChargePluginMetadata[]>({
    queryKey: ["/api/charge-plugins"],
  });

  // Fetch all plugin configurations
  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfig[]>({
    queryKey: ["/api/charge-plugin-configs"],
  });

  // Fetch employers for employer-scoped configs
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { pluginId: string; scope: string; employerId?: string; enabled: boolean; settings: Record<string, any> }) => {
      return apiRequest("POST", "/api/charge-plugin-configs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Plugin configuration created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create plugin configuration.",
        variant: "destructive",
      });
    },
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/charge-plugin-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs"] });
      toast({
        title: "Success",
        description: "Plugin configuration deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete plugin configuration.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedPluginId("");
    setSelectedScope("global");
    setSelectedEmployerId("");
    setSettingsJson("{}");
    setSettingsError("");
  };

  const handleCreate = () => {
    if (!selectedPluginId) {
      toast({
        title: "Validation Error",
        description: "Please select a plugin.",
        variant: "destructive",
      });
      return;
    }

    if (selectedScope === "employer" && !selectedEmployerId) {
      toast({
        title: "Validation Error",
        description: "Please select an employer for employer-scoped configuration.",
        variant: "destructive",
      });
      return;
    }

    // Validate JSON settings
    let settings: Record<string, any> = {};
    try {
      settings = JSON.parse(settingsJson);
      setSettingsError("");
    } catch (error) {
      setSettingsError("Invalid JSON format");
      toast({
        title: "Validation Error",
        description: "Invalid JSON format in settings.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      pluginId: selectedPluginId,
      scope: selectedScope,
      employerId: selectedScope === "employer" ? selectedEmployerId : undefined,
      enabled: true,
      settings,
    });
  };

  const getConfigsForPlugin = (pluginId: string) => {
    return configs.filter(c => c.pluginId === pluginId);
  };

  const getEmployerName = (employerId: string | null) => {
    if (!employerId) return null;
    const employer = employers.find(e => e.id === employerId);
    return employer?.name || employerId;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Charge Plugins</h1>
          <p className="text-muted-foreground mt-2">
            Configure automatic charge plugins for ledger transactions
          </p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-plugin-config">
          <Plus className="mr-2 h-4 w-4" />
          Add Configuration
        </Button>
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
            
            return (
              <Card key={plugin.id} data-testid={`card-plugin-${plugin.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle>{plugin.name}</CardTitle>
                      <CardDescription className="mt-2">{plugin.description}</CardDescription>
                      <div className="flex gap-2 mt-3">
                        <Badge variant="outline" className="text-xs">
                          Scope: {plugin.defaultScope}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          Triggers: {plugin.triggers.join(", ")}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {pluginConfigs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No configurations yet.</p>
                  ) : (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-foreground">Configurations</h4>
                      <div className="space-y-2">
                        {pluginConfigs.map((config) => (
                          <div
                            key={config.id}
                            className="flex items-center justify-between p-3 border rounded-md"
                            data-testid={`config-item-${config.id}`}
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-foreground">
                                  {config.scope === "global" ? "Global" : getEmployerName(config.employerId)}
                                </span>
                                <Badge variant={config.scope === "global" ? "default" : "secondary"} className="text-xs">
                                  {config.scope}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`enabled-${config.id}`} className="text-sm">
                                  Enabled
                                </Label>
                                <Switch
                                  id={`enabled-${config.id}`}
                                  checked={config.enabled}
                                  onCheckedChange={(enabled) => toggleEnabledMutation.mutate({ id: config.id, enabled })}
                                  data-testid={`switch-enabled-${config.id}`}
                                />
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteMutation.mutate(config.id)}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-${config.id}`}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Plugin Configuration</DialogTitle>
            <DialogDescription>
              Create a new configuration for a charge plugin
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="plugin">Plugin</Label>
              <Select value={selectedPluginId} onValueChange={setSelectedPluginId}>
                <SelectTrigger id="plugin" data-testid="select-plugin">
                  <SelectValue placeholder="Select a plugin..." />
                </SelectTrigger>
                <SelectContent>
                  {plugins.map((plugin) => (
                    <SelectItem key={plugin.id} value={plugin.id}>
                      {plugin.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="scope">Scope</Label>
              <Select value={selectedScope} onValueChange={(value: "global" | "employer") => setSelectedScope(value)}>
                <SelectTrigger id="scope" data-testid="select-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="employer">Employer-Specific</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectedScope === "employer" && (
              <div className="space-y-2">
                <Label htmlFor="employer">Employer</Label>
                <Select value={selectedEmployerId} onValueChange={setSelectedEmployerId}>
                  <SelectTrigger id="employer" data-testid="select-employer">
                    <SelectValue placeholder="Select an employer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {employers.filter(e => e.isActive).map((employer) => (
                      <SelectItem key={employer.id} value={employer.id}>
                        {employer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="settings">Settings (JSON)</Label>
              <Textarea
                id="settings"
                value={settingsJson}
                onChange={(e) => {
                  setSettingsJson(e.target.value);
                  setSettingsError("");
                }}
                placeholder='{"key": "value"}'
                className={`font-mono text-sm ${settingsError ? "border-destructive" : ""}`}
                rows={8}
                data-testid="textarea-settings"
              />
              {settingsError && (
                <p className="text-sm text-destructive" data-testid="text-settings-error">{settingsError}</p>
              )}
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Enter plugin-specific settings as JSON.</p>
                {selectedPluginId === "hour-fixed" && (
                  <div className="mt-2 p-2 bg-muted rounded text-xs">
                    <p className="font-semibold mb-1">Hour - Fixed Plugin Settings:</p>
                    <pre className="whitespace-pre-wrap">
{`{
  "rates": [
    {
      "effectiveDate": "2024-01-01",
      "rate": 15.50,
      "accountId": "account-uuid-here"
    }
  ]
}`}
                    </pre>
                    <p className="mt-1 text-muted-foreground">
                      Rate history array with effectiveDate, rate ($/hour), and accountId for charging.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-create-config">
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
