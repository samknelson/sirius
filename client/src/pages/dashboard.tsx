import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Home, AlertCircle, User, Building2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@shared/schema";
import { getAllPlugins } from "@/plugins/registry";
import { PluginConfig } from "@/plugins/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Dashboard() {
  const { user, permissions, components, staffPolicyGranted } = useAuth();
  
  const { data: userRoles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: [`/api/users/${user?.id}/roles`],
    enabled: !!user?.id,
  });

  const { data: pluginConfigs = [], isLoading: configsLoading } = useQuery<PluginConfig[]>({
    queryKey: ["/api/dashboard-plugins/config"],
  });

  const allPlugins = getAllPlugins();
  const policiesNeeded = useMemo(
    () => [...new Set(allPlugins.filter(p => p.requiredPolicy).map(p => p.requiredPolicy!))],
    [allPlugins]
  );

  const { data: policyResults = {}, isLoading: policiesLoading } = useQuery<Record<string, { allowed: boolean }>>({
    queryKey: ["/api/access/policies/batch", ...policiesNeeded],
    queryFn: async () => {
      if (policiesNeeded.length === 0) return {};
      const results: Record<string, { allowed: boolean }> = {};
      await Promise.all(
        policiesNeeded.map(async (policy) => {
          try {
            const response = await fetch(`/api/access/policies/${policy}`);
            if (response.ok) {
              const data = await response.json();
              results[policy] = { allowed: data.allowed };
            } else {
              results[policy] = { allowed: false };
            }
          } catch {
            results[policy] = { allowed: false };
          }
        })
      );
      return results;
    },
    staleTime: 30000,
    enabled: policiesNeeded.length > 0 && !!user,
  });
  
  // Check for linked employers (for employer role users without staff access)
  const { data: myEmployers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/my-employers"],
    enabled: !!user && permissions.includes("employer") && !staffPolicyGranted,
  });

  // Determine if user has roles but no linked records (and is not staff)
  const hasWorkerRole = permissions.includes("worker");
  const hasEmployerRole = permissions.includes("employer");
  const hasLinkedWorker = !!user?.workerId;
  const hasLinkedEmployer = myEmployers.length > 0;
  const showWorkerLinkageMessage = hasWorkerRole && !hasLinkedWorker && !staffPolicyGranted;
  const showEmployerLinkageMessage = hasEmployerRole && !hasLinkedEmployer && !staffPolicyGranted;

  const enabledPlugins = allPlugins.filter(plugin => {
    // Check if plugin is enabled
    const config = pluginConfigs.find(c => c.pluginId === plugin.id);
    const isEnabled = config ? config.enabled : plugin.enabledByDefault;
    
    if (!isEnabled) return false;

    // Check permissions
    if (plugin.requiredPermissions && plugin.requiredPermissions.length > 0) {
      if (!plugin.requiredPermissions.some(perm => permissions.includes(perm))) {
        return false;
      }
    }

    if (plugin.requiredComponent && components && !components.includes(plugin.requiredComponent)) {
      return false;
    }

    if (plugin.requiredPolicy) {
      const policyResult = policyResults[plugin.requiredPolicy];
      if (!policyResult || !policyResult.allowed) return false;
    }

    return true;
  });

  const fullWidthPlugins = enabledPlugins.filter(p => p.fullWidth);
  const gridPlugins = enabledPlugins.filter(p => !p.fullWidth);

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader title="Dashboard" icon={<Home className="text-primary-foreground" size={16} />} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {rolesLoading || configsLoading || policiesLoading ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Loading dashboard...</p>
          </div>
        ) : (
          <>
            {/* Show informational messages for users with roles but no linked records */}
            {(showWorkerLinkageMessage || showEmployerLinkageMessage) && (
              <div className="mb-6 space-y-4">
                {showWorkerLinkageMessage && (
                  <Card data-testid="card-worker-linkage-info">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <User className="h-5 w-5" />
                        Worker Account Setup
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Account Not Linked</AlertTitle>
                        <AlertDescription>
                          Your user account has worker access, but is not yet linked to a worker record. 
                          Please contact an administrator to link your account to your worker profile 
                          so you can view your dispatch history and worker information.
                        </AlertDescription>
                      </Alert>
                    </CardContent>
                  </Card>
                )}
                
                {showEmployerLinkageMessage && (
                  <Card data-testid="card-employer-linkage-info">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Building2 className="h-5 w-5" />
                        Employer Account Setup
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Account Not Linked</AlertTitle>
                        <AlertDescription>
                          Your user account has employer access, but is not yet linked to any employer records.
                          Please contact an administrator to link your account to your employer 
                          so you can access employer features and dispatch management.
                        </AlertDescription>
                      </Alert>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
            
            {fullWidthPlugins.length > 0 && (
              <div className="space-y-6 mb-6">
                {fullWidthPlugins.map(plugin => {
                  const PluginComponent = plugin.component;
                  return (
                    <PluginComponent
                      key={plugin.id}
                      userId={user?.id || ""}
                      userRoles={userRoles}
                      userPermissions={permissions}
                      enabledComponents={components}
                    />
                  );
                })}
              </div>
            )}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {gridPlugins.map(plugin => {
                const PluginComponent = plugin.component;
                return (
                  <PluginComponent
                    key={plugin.id}
                    userId={user?.id || ""}
                    userRoles={userRoles}
                    userPermissions={permissions}
                    enabledComponents={components}
                  />
                );
              })}
            </div>
            {enabledPlugins.length === 0 && !showWorkerLinkageMessage && !showEmployerLinkageMessage && (
              <div className="text-center text-muted-foreground">
                <p>No plugins are currently enabled for your dashboard.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
