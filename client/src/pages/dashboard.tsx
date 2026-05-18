import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Home, User, Building2, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@shared/schema";
import { resolveDashboardComponent } from "@/plugins/dashboard/registry";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface PluginManifestEntry {
  id: string;
  name: string;
  description: string;
  componentId: string;
  componentProps: Record<string, unknown> | null;
  order: number;
  fullWidth: boolean;
  requiredPermissions: string[];
  requiredPolicy?: string;
  requiredComponent?: string;
  hasSettings: boolean;
  enabledByDefault: boolean;
  enabled: boolean;
}

export default function Dashboard() {
  const { user, permissions, components } = useAuth();

  const { data: userRoles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: [`/api/users/${user?.id}/roles`],
    enabled: !!user?.id,
  });

  const { data: manifest = [], isLoading: manifestLoading } = useQuery<PluginManifestEntry[]>({
    queryKey: ["/api/dashboard-plugins/manifest"],
  });

  const policiesNeeded = useMemo(
    () => [...new Set(manifest.filter((p) => p.requiredPolicy).map((p) => p.requiredPolicy!))],
    [manifest],
  );

  const { data: policyResults = {}, isLoading: policiesLoading } = useQuery<
    Record<string, { allowed: boolean }>
  >({
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
              results[policy] = { allowed: data.access?.granted === true };
            } else {
              results[policy] = { allowed: false };
            }
          } catch {
            results[policy] = { allowed: false };
          }
        }),
      );
      return results;
    },
    staleTime: 30000,
    enabled: policiesNeeded.length > 0 && !!user,
  });

  const staffPolicyGranted =
    policyResults["staff"]?.allowed === true ||
    permissions.includes("admin") ||
    permissions.includes("staff");

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

  const enabledPlugins = manifest.filter((plugin) => {
    if (!plugin.enabled) return false;

    if (plugin.requiredPermissions.length > 0) {
      if (!plugin.requiredPermissions.some((perm) => permissions.includes(perm))) {
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

  const fullWidthPlugins = enabledPlugins.filter((p) => p.fullWidth);
  const gridPlugins = enabledPlugins.filter((p) => !p.fullWidth);

  const renderPlugin = (plugin: PluginManifestEntry) => {
    const PluginComponent = resolveDashboardComponent(plugin.componentId);
    return (
      <PluginComponent
        key={plugin.id}
        userId={user?.id || ""}
        userRoles={userRoles}
        userPermissions={permissions}
        enabledComponents={components}
        componentProps={plugin.componentProps ?? undefined}
      />
    );
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader title="Dashboard" icon={<Home className="text-primary-foreground" size={16} />} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {rolesLoading || manifestLoading || policiesLoading ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Loading dashboard...</p>
          </div>
        ) : (
          <>
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
              <div className="space-y-6 mb-6">{fullWidthPlugins.map(renderPlugin)}</div>
            )}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {gridPlugins.map(renderPlugin)}
            </div>
            {enabledPlugins.length === 0 && (
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
