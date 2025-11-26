import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import HourFixedConfigFormPage from "@/plugins/charge-plugins/hour-fixed/ConfigFormPage";
import GbhetLegalHourlyConfigFormPage from "@/plugins/charge-plugins/gbhet-legal-hourly/ConfigFormPage";

interface ChargePluginMetadata {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  defaultScope: "global" | "employer";
}

// This page routes to the correct form component based on pluginId
export default function ChargePluginFormPage() {
  const { pluginId } = useParams<{ pluginId: string }>();

  const { data: plugins = [], isLoading } = useQuery<ChargePluginMetadata[]>({
    queryKey: ["/api/charge-plugins"],
  });

  const plugin = plugins.find(p => p.id === pluginId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="space-y-6 p-8">
        <div className="flex items-center gap-4">
          <Link href="/config/ledger/charge-plugins">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Charge Plugins
            </Button>
          </Link>
        </div>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-foreground">Plugin Not Available</h2>
          <p className="text-muted-foreground mt-2">
            The plugin "{pluginId}" is not available. It may be disabled or not installed.
          </p>
        </div>
      </div>
    );
  }

  // Map pluginId to the appropriate form component
  switch (pluginId) {
    case "hour-fixed":
      return <HourFixedConfigFormPage />;
    case "gbhet-legal-hourly":
      return <GbhetLegalHourlyConfigFormPage />;
    default:
      return (
        <div className="p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Form Not Available</h2>
          <p className="text-muted-foreground">
            No form configuration is available for plugin "{pluginId}".
          </p>
        </div>
      );
  }
}
