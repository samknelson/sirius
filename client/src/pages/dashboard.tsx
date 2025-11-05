import { PageHeader } from "@/components/layout/PageHeader";
import { Home } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@shared/schema";
import { getAllPlugins } from "@/plugins/registry";
import { PluginConfig } from "@/plugins/types";

export default function Dashboard() {
  const { user, permissions } = useAuth();
  
  const { data: userRoles = [] } = useQuery<Role[]>({
    queryKey: ["/api/users", user?.id, "roles"],
    enabled: !!user?.id,
  });

  const { data: pluginConfigs = [] } = useQuery<PluginConfig[]>({
    queryKey: ["/api/dashboard-plugins/config"],
  });

  // Get all registered plugins
  const allPlugins = getAllPlugins();

  // Filter plugins based on:
  // 1. Plugin is enabled in config (or enabled by default if no config exists)
  // 2. User has required permissions
  const enabledPlugins = allPlugins.filter(plugin => {
    // Check if plugin is enabled
    const config = pluginConfigs.find(c => c.pluginId === plugin.id);
    const isEnabled = config ? config.enabled : plugin.enabledByDefault;
    
    if (!isEnabled) return false;

    // Check permissions
    if (plugin.requiredPermissions && plugin.requiredPermissions.length > 0) {
      return plugin.requiredPermissions.some(perm => permissions.includes(perm));
    }

    return true;
  });

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader title="Dashboard" icon={<Home className="text-primary-foreground" size={16} />} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {enabledPlugins.map(plugin => {
            const PluginComponent = plugin.component;
            return (
              <PluginComponent
                key={plugin.id}
                userId={user?.id || ""}
                userRoles={userRoles}
                userPermissions={permissions}
              />
            );
          })}
        </div>
      </main>
    </div>
  );
}
