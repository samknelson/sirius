import { pluginManifestQueryKey } from "@/plugins/_core";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SchemaForm, type IChangeEvent } from "@/components/json-schema-form";
import { HtmlEditorWidget } from "@/components/json-schema-form/widgets/HtmlEditorWidget";
import type { RegistryWidgetsType } from "@rjsf/utils";

interface PluginManifestEntry {
  id: string;
  name: string;
  description: string;
  hasSettings: boolean;
}

interface PluginSettingsResponse {
  schema: any;
  uiSchema: any;
  value: any;
}

const extraWidgets = {
  htmlEditor: HtmlEditorWidget,
} as unknown as RegistryWidgetsType;

export default function PluginSettingsPage() {
  usePageTitle("Plugin Settings");
  const { pluginId } = useParams<{ pluginId: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: manifest = [], isLoading: manifestLoading } = useQuery<PluginManifestEntry[]>({
    queryKey: pluginManifestQueryKey("dashboard"),
  });

  const plugin = pluginId ? manifest.find((p) => p.id === pluginId) : undefined;

  const { data, isLoading, isError } = useQuery<PluginSettingsResponse>({
    queryKey: ["/api/plugins/dashboard", pluginId, "settings"],
    queryFn: async () => {
      const res = await fetch(`/api/plugins/dashboard/${pluginId}/settings`);
      if (!res.ok) throw new Error("Failed to load plugin settings");
      return res.json();
    },
    enabled: !!pluginId && !!plugin?.hasSettings,
  });

  const [formData, setFormData] = useState<any>(undefined);
  useEffect(() => {
    if (data?.value !== undefined) setFormData(data.value);
  }, [data?.value]);

  const saveMutation = useMutation({
    mutationFn: async (value: any) => {
      await apiRequest("PUT", `/api/plugins/dashboard/${pluginId}/settings`, value);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/dashboard", pluginId, "settings"] });
      queryClient.invalidateQueries({ queryKey: pluginManifestQueryKey("dashboard") });
      toast({ title: "Settings Saved", description: `${plugin?.name ?? "Plugin"} settings have been updated.` });
    },
    onError: (err: any) => {
      toast({
        title: "Save Failed",
        description: err?.message || "Failed to save plugin settings.",
        variant: "destructive",
      });
    },
  });

  const backButton = (
    <Button
      variant="ghost"
      onClick={() => navigate("/config/dashboard-plugins")}
      className="mb-4"
      data-testid="button-back-to-plugins"
    >
      <ChevronLeft className="h-4 w-4 mr-2" />
      Back to Dashboard Plugins
    </Button>
  );

  if (manifestLoading) {
    return (
      <div className="space-y-6">
        {backButton}
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!pluginId || !plugin) {
    return (
      <div className="space-y-6">
        {backButton}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Plugin not found{pluginId ? `: ${pluginId}` : ""}.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!plugin.hasSettings) {
    return (
      <div className="space-y-6">
        {backButton}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            The plugin "{plugin.name}" does not have configurable settings.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        {backButton}
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        {backButton}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Failed to load plugin settings.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backButton}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {plugin.name}
        </h1>
        <p className="text-muted-foreground mt-2">{plugin.description}</p>
      </div>
      <SchemaForm
        schema={data.schema}
        uiSchema={data.uiSchema}
        formData={formData}
        extraWidgets={extraWidgets}
        onChange={(e: IChangeEvent) => setFormData(e.formData)}
        onSubmit={(e: IChangeEvent) => saveMutation.mutate(e.formData)}
      >
        <div className="flex justify-end mt-4">
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save-plugin-settings"
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </SchemaForm>
    </div>
  );
}
