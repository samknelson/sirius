import { Component, useMemo, type ErrorInfo, type ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Home, User, Building2, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@shared/schema";
import {
  hasDashboardComponent,
  resolveDashboardComponent,
} from "@/plugins/dashboard/registry";
import { DashboardConfigContext } from "@/plugins/dashboard/useDashboardContent";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

/**
 * One rendered dashboard item — a single dashboard config row joined with its
 * plugin's display metadata. The dashboard renders one widget per item, so a
 * plugin configured several times produces several items (each scoped to its
 * own `configId`). Served by `GET /api/dashboard-plugins/items`.
 */
interface DashboardItem {
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
  configId: string;
  configName: string | null;
  ordering: number;
}

export default function Dashboard() {
  const { user, permissions, components } = useAuth();

  const { data: userRoles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: [`/api/users/${user?.id}/roles`],
    enabled: !!user?.id,
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery<DashboardItem[]>({
    queryKey: ["/api/dashboard-plugins/items"],
  });

  const policiesNeeded = useMemo(
    () => Array.from(new Set(items.filter((p) => p.requiredPolicy).map((p) => p.requiredPolicy!))),
    [items],
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

  const enabledItems = items.filter((item) => {
    if (!item.enabled) return false;

    if (item.requiredPermissions.length > 0) {
      if (!item.requiredPermissions.some((perm) => permissions.includes(perm))) {
        return false;
      }
    }

    if (item.requiredComponent && components && !components.includes(item.requiredComponent)) {
      return false;
    }

    if (item.requiredPolicy) {
      const policyResult = policyResults[item.requiredPolicy];
      if (!policyResult || !policyResult.allowed) return false;
    }

    return true;
  });

  const fullWidthItems = enabledItems.filter((p) => p.fullWidth);
  const gridItems = enabledItems.filter((p) => !p.fullWidth);

  const renderItem = (item: DashboardItem) => {
    if (!hasDashboardComponent(item.componentId)) {
      return (
        <MissingPluginCard
          key={item.configId}
          pluginId={item.id}
          pluginName={item.configName ?? item.name}
          componentId={item.componentId}
        />
      );
    }
    const PluginComponent = resolveDashboardComponent(item.componentId);
    return (
      <PluginErrorBoundary
        key={item.configId}
        pluginId={item.id}
        pluginName={item.configName ?? item.name}
        componentId={item.componentId}
      >
        <DashboardConfigContext.Provider value={{ configId: item.configId }}>
          <PluginComponent
            userId={user?.id || ""}
            userRoles={userRoles}
            componentProps={item.componentProps ?? undefined}
            configId={item.configId}
            configName={item.configName}
          />
        </DashboardConfigContext.Provider>
      </PluginErrorBoundary>
    );
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader title="Dashboard" icon={<Home className="text-primary-foreground" size={16} />} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {rolesLoading || itemsLoading || policiesLoading ? (
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

            {fullWidthItems.length > 0 && (
              <div className="space-y-6 mb-6">{fullWidthItems.map(renderItem)}</div>
            )}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {gridItems.map(renderItem)}
            </div>
            {enabledItems.length === 0 && (
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

interface MissingPluginCardProps {
  pluginId: string;
  pluginName: string;
  componentId: string;
}

function MissingPluginCard({ pluginId, pluginName, componentId }: MissingPluginCardProps) {
  return (
    <Card data-testid={`card-plugin-unavailable-${pluginId}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle className="h-4 w-4" />
          {pluginName}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Widget unavailable</AlertTitle>
          <AlertDescription>
            Component <code className="font-mono text-xs">{componentId}</code> is
            unavailable in this build. Plugin id:{" "}
            <code className="font-mono text-xs">{pluginId}</code>.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

interface PluginErrorBoundaryProps {
  pluginId: string;
  pluginName: string;
  componentId: string;
  children: ReactNode;
}

interface PluginErrorBoundaryState {
  error: Error | null;
}

class PluginErrorBoundary extends Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  state: PluginErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `Dashboard plugin "${this.props.pluginId}" (${this.props.componentId}) failed to render:`,
      error,
      info,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <Card data-testid={`card-plugin-error-${this.props.pluginId}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4" />
              {this.props.pluginName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Widget failed to render</AlertTitle>
              <AlertDescription>
                Component <code className="font-mono text-xs">{this.props.componentId}</code>{" "}
                threw an error. Plugin id:{" "}
                <code className="font-mono text-xs">{this.props.pluginId}</code>.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}
