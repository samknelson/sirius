import { useParams } from "wouter";
import HourFixedConfigFormPage from "@/plugins/charge-plugins/hour-fixed/ConfigFormPage";

// This page routes to the correct form component based on pluginId
export default function ChargePluginFormPage() {
  const { pluginId } = useParams<{ pluginId: string }>();

  // Map pluginId to the appropriate form component
  // In the future, this could be extended to use a registry pattern
  switch (pluginId) {
    case "hour-fixed":
      return <HourFixedConfigFormPage />;
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
