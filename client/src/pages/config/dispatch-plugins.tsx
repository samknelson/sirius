import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Puzzle, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import type { EligibilityPluginMetadata } from "@shared/schema";

export default function DispatchPluginsPage() {
  usePageTitle("Dispatch Eligibility Plugins");
  const { toast } = useToast();
  const [backfillingPlugin, setBackfillingPlugin] = useState<string | null>(null);

  const { data: plugins, isLoading } = useQuery<EligibilityPluginMetadata[]>({
    queryKey: ["/api/dispatch-eligibility-plugins"],
  });

  const backfillMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      setBackfillingPlugin(pluginId);
      return apiRequest("POST", `/api/admin/dispatch-elig-plugins/${pluginId}/backfill`);
    },
    onSuccess: (data: { workersProcessed: number; entriesCreated: number }, pluginId: string) => {
      toast({
        title: "Backfill complete",
        description: `Processed ${data.workersProcessed} workers, created ${data.entriesCreated} entries.`,
      });
      setBackfillingPlugin(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Backfill failed",
        description: error.message,
        variant: "destructive",
      });
      setBackfillingPlugin(null);
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const sortedPlugins = [...(plugins || [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">
          Dispatch Eligibility Plugins
        </h1>
        <p className="text-muted-foreground">
          View registered dispatch eligibility plugins and trigger data backfills.
        </p>
      </div>

      {sortedPlugins.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-plugins">
            No dispatch eligibility plugins are registered.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedPlugins.map(plugin => {
            const isBackfilling = backfillingPlugin === plugin.id && backfillMutation.isPending;
            return (
              <Card key={plugin.id} data-testid={`card-plugin-${plugin.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <CardTitle className="flex items-center gap-2 text-base" data-testid={`text-plugin-name-${plugin.id}`}>
                        <Puzzle className="h-4 w-4 shrink-0" />
                        {plugin.name}
                      </CardTitle>
                      <CardDescription data-testid={`text-plugin-desc-${plugin.id}`}>{plugin.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {plugin.componentEnabled ? (
                        <Badge variant="outline" className="text-green-600 border-green-200" data-testid={`badge-enabled-${plugin.id}`}>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-disabled-${plugin.id}`}>
                          <XCircle className="h-3 w-3 mr-1" />
                          Disabled
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-mono" data-testid={`text-plugin-id-${plugin.id}`}>
                      {plugin.id}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => backfillMutation.mutate(plugin.id)}
                      disabled={backfillMutation.isPending}
                      data-testid={`button-backfill-${plugin.id}`}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isBackfilling ? "animate-spin" : ""}`} />
                      {isBackfilling ? "Running..." : "Run Backfill"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
