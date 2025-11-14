import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { getPluginById } from "@/plugins/registry";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function PluginSettingsPage() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const [_, navigate] = useLocation();
  const queryClient = useQueryClient();

  if (!pluginId) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Invalid plugin URL. Please navigate from the Dashboard Plugins page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const plugin = getPluginById(pluginId);

  if (!plugin) {
    return (
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            onClick={() => navigate("/config/dashboard-plugins")}
            className="mb-4"
            data-testid="button-back-to-plugins"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Dashboard Plugins
          </Button>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Plugin not found. The plugin "{pluginId}" does not exist in the registry.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!plugin.settingsComponent) {
    return (
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            onClick={() => navigate("/config/dashboard-plugins")}
            className="mb-4"
            data-testid="button-back-to-plugins"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Dashboard Plugins
          </Button>
        </div>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            The plugin "{plugin.name}" does not have any configurable settings. 
            Click the button above to return to the Dashboard Plugins page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const SettingsComponent = plugin.settingsComponent;

  const handleConfigSaved = () => {
    // Invalidate all dashboard plugin queries to refresh UI
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard-plugins"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard-plugins/config"] });
  };

  // Generic load/save functions for plugin settings
  const loadSettings = async () => {
    const response = await fetch(`/api/dashboard-plugins/${plugin.id}/settings`);
    if (!response.ok) {
      throw new Error("Failed to load settings");
    }
    return response.json();
  };

  const saveSettings = async (settings: any) => {
    await apiRequest("PUT", `/api/dashboard-plugins/${plugin.id}/settings`, settings);
    handleConfigSaved();
  };

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          onClick={() => navigate("/config/dashboard-plugins")}
          className="mb-4"
          data-testid="button-back-to-plugins"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Dashboard Plugins
        </Button>
      </div>
      <SettingsComponent
        plugin={plugin}
        queryClient={queryClient}
        onConfigSaved={handleConfigSaved}
        loadSettings={loadSettings}
        saveSettings={saveSettings}
      />
    </div>
  );
}
