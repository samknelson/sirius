import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { chargePluginUIRegistry } from "@/plugins/charge-plugins";

interface ChargePluginMetadata {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  defaultScope: "global" | "employer";
}

export default function ChargePluginConfigPage() {
  const params = useParams<{ pluginId: string }>();
  const pluginId = params.pluginId || "";

  // Fetch plugin metadata
  const { data: plugins = [], isLoading } = useQuery<ChargePluginMetadata[]>({
    queryKey: ["/api/charge-plugins"],
  });

  const plugin = plugins.find(p => p.id === pluginId);
  const registration = chargePluginUIRegistry.get(pluginId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/config/ledger/charge-plugins">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Charge Plugins
            </Button>
          </Link>
        </div>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-foreground">Plugin Not Found</h2>
          <p className="text-muted-foreground mt-2">
            The plugin "{pluginId}" could not be found.
          </p>
        </div>
      </div>
    );
  }

  if (!registration) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/config/ledger/charge-plugins">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Charge Plugins
            </Button>
          </Link>
        </div>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-foreground">Configuration UI Not Available</h2>
          <p className="text-muted-foreground mt-2">
            The plugin "{plugin.name}" does not have a configuration interface yet.
          </p>
        </div>
      </div>
    );
  }

  const ConfigComponent = registration.configComponent;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/config/ledger/charge-plugins">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Charge Plugins
          </Button>
        </Link>
      </div>
      
      <ConfigComponent pluginId={pluginId} />
    </div>
  );
}
