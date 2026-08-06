import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import {
  pluginManifestQueryKey,
  pluginConfigsQueryKey,
  pluginConfigsUrl,
} from "@/plugins/_core";
import type { JsonSchema } from "@shared/json-schema-form";
import { SchemaForm, type IChangeEvent } from "@/components/json-schema-form";

const KIND = "worker-list" as const;
const PLUGIN_ID = "membership-column";

interface ManifestEntry {
  id: string;
  name: string;
  description?: string;
  configSchema?: JsonSchema;
}

interface WorkerListConfigRow {
  id: string;
  pluginId: string;
  enabled: boolean;
  name: string | null;
  ordering: number;
  data: Record<string, unknown> | null;
}

/**
 * Admin settings page for the /workers list Membership column. Reads the
 * membership-column plugin's settings schema from the unified manifest and
 * edits its singleton plugin_configs row via the generic config endpoints.
 */
export default function WorkerListSettingsPage() {
  usePageTitle("Worker List Settings");
  const { toast } = useToast();

  const { data: manifest = [], isLoading: manifestLoading } = useQuery<ManifestEntry[]>({
    queryKey: pluginManifestQueryKey(KIND),
    // The schema may carry dynamically-derived pieces; never trust a
    // session-old cached manifest (RJSF prunes values missing from enums).
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: configs = [], isLoading: configsLoading } = useQuery<WorkerListConfigRow[]>({
    queryKey: pluginConfigsQueryKey(KIND),
  });

  const plugin = manifest.find((p) => p.id === PLUGIN_ID);
  const config = configs.find((c) => c.pluginId === PLUGIN_ID);

  const [formData, setFormData] = useState<Record<string, unknown>>({});
  // Remount the form when the loaded config changes so RJSF picks up the
  // seeded formData (custom fields ignore post-mount formData prop changes).
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (config) {
      setFormData((config.data ?? {}) as Record<string, unknown>);
      setFormKey((k) => k + 1);
    }
  }, [config?.id]);

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (config) {
        return apiRequest("PATCH", `${pluginConfigsUrl(KIND)}/${config.id}`, { data });
      }
      // The singleton seeder creates the row at boot; this is a safety net
      // for environments where it has not run yet.
      return apiRequest("POST", pluginConfigsUrl(KIND), {
        pluginId: PLUGIN_ID,
        name: plugin?.name ?? "Membership Column",
        enabled: true,
        ordering: 0,
        data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginConfigsQueryKey(KIND) });
      queryClient.invalidateQueries({ queryKey: ["/api/workers/list-settings"] });
      toast({ title: "Saved", description: "Worker list settings updated." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to save worker list settings."),
        variant: "destructive",
      });
    },
  });

  if (manifestLoading || configsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (!plugin?.configSchema) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground" data-testid="text-unavailable">
            Worker list settings are not available. The cardcheck component may be disabled.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="text-page-title">
          Worker List Settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure what the Membership column on the worker list shows.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{plugin.name}</CardTitle>
          {plugin.description && <CardDescription>{plugin.description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <SchemaForm
            key={formKey}
            schema={plugin.configSchema}
            formData={formData}
            onChange={(e: IChangeEvent) => setFormData((e.formData ?? {}) as Record<string, unknown>)}
            onSubmit={(e: IChangeEvent) =>
              saveMutation.mutate((e.formData ?? {}) as Record<string, unknown>)
            }
          >
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-worker-list-settings">
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          </SchemaForm>
        </CardContent>
      </Card>
    </div>
  );
}
