import { useState, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Info, Database, AlertTriangle, Loader2, Archive, Trash2, Shield, ChevronRight, ChevronDown, Plug, KeyRound } from "lucide-react";
import { apiRequest , getApiErrorMessage } from "@/lib/queryClient";
import type { ComponentDefinition, ComponentConfig } from "@shared/components";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface EnvVarInfo {
  name: string;
  description: string;
  secret: boolean;
  category: string;
  required: boolean;
  /** Whether the variable currently has a non-empty value. Never the value. */
  isSet: boolean;
}

interface SchemaInfo {
  componentId: string;
  hasSchema: boolean;
  tables: string[];
  schemaState: any;
  tablesExist: boolean[];
}

interface PendingAction {
  componentId: string;
  enabled: boolean;
  component: ComponentDefinition;
  schemaInfo?: SchemaInfo;
}

export default function ComponentsConfigPage() {
  usePageTitle("Components");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: componentConfigs = [], isLoading, isFetching, isError, refetch } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    queryFn: async () => {
      const configs = await apiRequest("GET", "/api/components/config");
      if (!Array.isArray(configs) || configs.some(c =>
        !c?.definition || c.definition.id !== c.componentId || typeof c.enabled !== "boolean" ||
        typeof c.definition.name !== "string" || typeof c.definition.description !== "string" ||
        typeof c.definition.enabledByDefault !== "boolean") ||
        new Set(configs.map(c => c.componentId)).size !== configs.length) {
        throw new Error("The server returned an incomplete component catalog. Refresh after the deployment finishes.");
      }
      return configs;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const allComponents = useMemo(() =>
    componentConfigs.flatMap(config => config.definition ? [config.definition] : []), [componentConfigs]);
  const catalogIncomplete = allComponents.length !== componentConfigs.length;
  const states = new Map(componentConfigs.map(config => [config.componentId, config.enabled]));

  // Declared env vars, linked to components by declaration.category ===
  // component.id (a convention — "core"/"platform" and any category that
  // isn't a component id simply never match a row here).
  const { data: envVars = [] } = useQuery<EnvVarInfo[]>({
    queryKey: ["/api/components/env-vars"],
  });
  const envVarsByComponent = useMemo(() => {
    const map: Record<string, EnvVarInfo[]> = {};
    for (const v of envVars) {
      (map[v.category] ??= []).push(v);
    }
    return map;
  }, [envVars]);

  const actionLock = useRef(false);
  const submissionLock = useRef(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [isCheckingSchema, setIsCheckingSchema] = useState(false);
  const [dataAction, setDataAction] = useState<"retain" | "delete">("retain");
  const [lastError, setLastError] = useState<{
    componentId: string;
    title: string;
    message: string;
    missingDependencies: Array<{ componentId: string; componentName: string; reason: string; missingTables: string[] }>;
    failedOperations: Array<{ tableName: string; operation: string; error?: string }>;
    repairable: boolean;
    driftTables: Array<{ tableName: string; hasRows: boolean; detail: string }>;
  } | null>(null);

  const refreshConfirmedState = async (componentId: string, enabled: boolean): Promise<boolean> => {
    await queryClient.cancelQueries({ queryKey: ["/api/components/config"] });
    // Patch only the confirmed flag; never replace unrelated switches optimistically.
    queryClient.setQueryData<ComponentConfig[]>(["/api/components/config"], previous =>
      previous?.map(config => config.componentId === componentId ? { ...config, enabled } : config));
    try {
      await queryClient.invalidateQueries({ queryKey: ["/api/components/config"] }, { throwOnError: true });
      const latest = queryClient.getQueryData<ComponentConfig[]>(["/api/components/config"]);
      if (latest?.find(c => c.componentId === componentId)?.enabled !== enabled) {
        toast({ title: "Component state changed", description: "Another change was detected. The current server state is shown.", variant: "destructive" });
        return false;
      }
      return true;
    } catch {
      toast({ title: "Change saved; refresh failed", description: "The server confirmed the change, but current status could not be refreshed. Retry the status refresh.", variant: "destructive" });
      return false;
    }
  };

  const updateComponentMutation = useMutation({
    mutationFn: async ({ componentId, enabled, confirmDestructive, retainData }: { componentId: string; enabled: boolean; confirmDestructive?: string; retainData?: boolean }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/components/config"] });
      const result = await apiRequest("PUT", `/api/components/config/${componentId}`, { enabled, confirmDestructive, retainData });
      if (result?.componentId !== componentId || result.enabled !== enabled) {
        throw new Error(result?.message || "The server did not confirm the requested component state.");
      }
      return result;
    },
    onSuccess: async (data, variables) => {
      setLastError(null);
      if (await refreshConfirmedState(variables.componentId, data.enabled)) toast({
        title: "Component Updated",
        description: `Component ${data.enabled ? "enabled" : "disabled"} successfully.`,
      });
      setPendingAction(null);
      setConfirmText("");
      setDataAction("retain");
    },
    onError: async (error: any, variables) => {
      const data = error?.data;
      const isDependencyError = Array.isArray(data?.missingDependencies) && data.missingDependencies.length > 0;
      const failedOps = Array.isArray(data?.schemaOperations)
        ? data.schemaOperations.filter((op: any) => !op.success)
        : [];
      setLastError({
        componentId: variables.componentId,
        title: isDependencyError ? "Missing prerequisite components" : "Update Failed",
        message: data?.message || getApiErrorMessage(error, "Failed to update component."),
        missingDependencies: isDependencyError ? data.missingDependencies : [],
        failedOperations: failedOps,
        repairable: data?.repairable === true,
        driftTables: Array.isArray(data?.driftTables) ? data.driftTables : [],
      });
      toast({
        title: isDependencyError ? "Missing Prerequisites" : "Update Failed",
        description: data?.message || getApiErrorMessage(error, "Failed to update component."),
        variant: "destructive",
      });
      // A failed lifecycle operation may already have safely disabled the flag.
      // Re-read it instead of assuming that the requested change was reversed.
      await queryClient.invalidateQueries({ queryKey: ["/api/components/config"] });
      setPendingAction(null);
      setConfirmText("");
      setDataAction("retain");
    },
    onSettled: () => { actionLock.current = false; submissionLock.current = false; },
  });

  const repairComponentMutation = useMutation({
    mutationFn: async ({ componentId }: { componentId: string }) => {
      const result = await apiRequest("POST", `/api/components/config/${componentId}/repair`, {});
      if (result?.componentId !== componentId || result.enabled !== true) {
        throw new Error(result?.message || "The server did not confirm that the repaired component is enabled.");
      }
      return result;
    },
    onSuccess: async (data: any, variables) => {
      setLastError(null);
      if (await refreshConfirmedState(variables.componentId, data.enabled)) toast({
        title: "Component Repaired",
        description: data?.message || `Component ${variables.componentId} was repaired and enabled.`,
      });
    },
    onError: async (error: any, variables) => {
      const data = error?.data;
      const failedOps = Array.isArray(data?.schemaOperations)
        ? data.schemaOperations.filter((op: any) => !op.success)
        : [];
      setLastError({
        componentId: variables.componentId,
        title: "Repair Failed",
        message: data?.message || error?.message || "Failed to repair component.",
        missingDependencies: Array.isArray(data?.missingDependencies) ? data.missingDependencies : [],
        failedOperations: failedOps,
        repairable: false,
        driftTables: [],
      });
      toast({
        title: "Repair Failed",
        description: data?.message || getApiErrorMessage(error, "Failed to repair component."),
        variant: "destructive",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/components/config"] });
    },
    onSettled: () => { actionLock.current = false; },
  });

  const busy = isCheckingSchema || updateComponentMutation.isPending || repairComponentMutation.isPending ||
    isFetching || isError || catalogIncomplete;

  const handleToggle = async (componentId: string, enabled: boolean) => {
    if (busy || actionLock.current || pendingAction) return;
    const component = allComponents.find(c => c.id === componentId);
    if (!component) return;
    actionLock.current = true;

    if (component.managesSchema) {
      setIsCheckingSchema(true);
      try {
        const response = await fetch(`/api/components/${componentId}/schema-info`);
        if (!response.ok) {
          toast({
            title: "Schema Check Failed",
            description: "Unable to retrieve schema information for this component.",
            variant: "destructive",
          });
          setIsCheckingSchema(false);
          actionLock.current = false;
          return;
        }
        const schemaInfo: SchemaInfo = await response.json();
        
        if (!enabled && schemaInfo.tablesExist.some(exists => exists)) {
          setPendingAction({ componentId, enabled, component, schemaInfo });
          setIsCheckingSchema(false);
          return;
        }
        
        if (enabled) {
          setPendingAction({ componentId, enabled, component, schemaInfo });
          setIsCheckingSchema(false);
          return;
        }
      } catch (error) {
        toast({ title: "Schema Check Failed", description: getApiErrorMessage(error, "Unable to retrieve schema information."), variant: "destructive" });
        setIsCheckingSchema(false);
        actionLock.current = false;
        return;
      }
      setIsCheckingSchema(false);
    }

    updateComponentMutation.mutate({ componentId, enabled });
  };

  const handleConfirmAction = () => {
    if (!pendingAction || busy || submissionLock.current) return;

    const isDisabling = !pendingAction.enabled;
    const hasActiveTables = pendingAction.schemaInfo?.tablesExist.some(exists => exists);
    const isDeleting = dataAction === "delete";

    if (isDisabling && hasActiveTables && isDeleting && confirmText !== "DELETE") {
      toast({
        title: "Confirmation Required",
        description: "Please type DELETE to confirm.",
        variant: "destructive",
      });
      return;
    }

    submissionLock.current = true;
    updateComponentMutation.mutate({
      componentId: pendingAction.componentId,
      enabled: pendingAction.enabled,
      retainData: !isDeleting,
      confirmDestructive: isDisabling && hasActiveTables && isDeleting ? "DELETE" : undefined,
    });
  };

  const handleCancelAction = () => {
    if (updateComponentMutation.isPending || repairComponentMutation.isPending) return;
    actionLock.current = false;
    setPendingAction(null);
    setConfirmText("");
    setDataAction("retain");
  };

  // Sort components alphabetically by component ID
  const sortedComponents = [...allComponents].sort((a, b) => 
    a.id.localeCompare(b.id)
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">
            Components
          </h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">
          Components
        </h1>
        <p className="text-muted-foreground mt-2">
          Enable or disable components to control which features are available in the application.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Components are parts of the software that can be independently enabled or disabled.
          Disabling a component will hide its functionality from all users.
        </AlertDescription>
      </Alert>
      {(isError || catalogIncomplete) && (
        <Alert variant="destructive" data-testid="alert-component-status">
          <AlertDescription>
            Current component status is unavailable or the server catalog is incomplete.
            Any displayed switches are last-confirmed values, not evidence that a feature was disabled.
            <Button variant="outline" className="ml-3" onClick={() => void refetch()} disabled={isFetching}>Retry status refresh</Button>
          </AlertDescription>
        </Alert>
      )}
      {isFetching && <p role="status" className="text-muted-foreground">Refreshing component status…</p>}

      {lastError && (
        <Alert variant="destructive" data-testid="alert-component-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <p className="font-medium" data-testid="text-component-error-title">
                  {lastError.title} — <span className="font-mono">{lastError.componentId}</span>
                </p>
                <button
                  type="button"
                  className="text-sm underline shrink-0"
                  onClick={() => setLastError(null)}
                  data-testid="button-dismiss-component-error"
                >
                  Dismiss
                </button>
              </div>
              <p data-testid="text-component-error-message">{lastError.message}</p>
              {lastError.missingDependencies.length > 0 && (
                <ul className="list-disc list-inside space-y-1">
                  {lastError.missingDependencies.map((dep) => (
                    <li key={dep.componentId} data-testid={`text-missing-dependency-${dep.componentId}`}>
                      <span className="font-medium">{dep.componentName}</span>{" "}
                      <span className="font-mono text-xs">({dep.componentId})</span>{" "}
                      {dep.reason === "disabled"
                        ? "— not enabled. Enable it first."
                        : `— enabled but missing tables: ${dep.missingTables.join(", ")}`}
                    </li>
                  ))}
                </ul>
              )}
              {lastError.failedOperations.length > 0 && (
                <ul className="list-disc list-inside space-y-1">
                  {lastError.failedOperations.map((op, idx) => (
                    <li key={`${op.tableName}-${idx}`} className="font-mono text-xs" data-testid={`text-failed-operation-${idx}`}>
                      {op.operation} {op.tableName}{op.error ? `: ${op.error}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {lastError.driftTables.some((t) => t.hasRows) && (
                <p className="text-sm" data-testid="text-repair-blocked">
                  Some mismatched tables contain data ({lastError.driftTables.filter((t) => t.hasRows).map((t) => t.tableName).join(", ")}).
                  They cannot be repaired automatically and need an authored migration.
                </p>
              )}
              {lastError.repairable && (
                <div className="space-y-1">
                  <p className="text-sm">
                    All mismatched tables are empty, so they can be safely dropped and recreated.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !!pendingAction}
                    onClick={() => {
                      if (actionLock.current) return;
                      actionLock.current = true;
                      repairComponentMutation.mutate({ componentId: lastError.componentId });
                    }}
                    data-testid="button-repair-component"
                  >
                    {repairComponentMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Repairing…
                      </>
                    ) : (
                      "Repair and retry"
                    )}
                  </Button>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {sortedComponents.length === 0 && !isError && !catalogIncomplete ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No components are registered. Add components to the registry to see them here.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Component ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedComponents.flatMap((component) => {
                const isExpanded = !!expandedRows[component.id];
                const tables = component.schemaManifest?.tables ?? [];
                const permissions = component.permissions ?? [];
                const pluginConfigs = component.pluginConfigs ?? [];
                const componentEnvVars = envVarsByComponent[component.id] ?? [];
                const unsetEnvVars = componentEnvVars.filter((v) => !v.isSet);
                const rows = [
                  <TableRow key={`${component.id}-main`} data-testid={`row-component-${component.id}`}>
                      <TableCell className="w-10">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setExpandedRows(prev => ({ ...prev, [component.id]: !prev[component.id] }))}
                          aria-label={isExpanded ? "Collapse details" : "Expand details"}
                          data-testid={`button-toggle-component-${component.id}`}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        <div className="flex items-center gap-2 flex-wrap">
                          {component.id}
                          {component.managesSchema && (
                            <Badge variant="outline" className="text-xs">
                              <Database className="h-3 w-3 mr-1" />
                              Schema
                            </Badge>
                          )}
                          {component.permissions && component.permissions.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <Shield className="h-3 w-3 mr-1" />
                              Permissions
                            </Badge>
                          )}
                          {component.pluginConfigs && component.pluginConfigs.length > 0 && (
                            <Badge variant="outline" className="text-xs" data-testid={`badge-plugin-configs-${component.id}`}>
                              <Plug className="h-3 w-3 mr-1" />
                              Plugin Config
                            </Badge>
                          )}
                          {componentEnvVars.length > 0 && (
                            <Badge
                              variant="outline"
                              className="text-xs"
                              data-testid={`badge-env-vars-${component.id}`}
                            >
                              <KeyRound className="h-3 w-3 mr-1" />
                              Env Vars ({componentEnvVars.length})
                              {unsetEnvVars.length > 0 && (
                                <span className="ml-1 text-amber-700 dark:text-amber-400">
                                  {unsetEnvVars.length} unset
                                </span>
                              )}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{component.name}</TableCell>
                      <TableCell className="text-muted-foreground">{component.description}</TableCell>
                      <TableCell className="text-right">
                        <Switch
                          id={`component-${component.id}`}
                          checked={states.get(component.id) ?? false}
                          onCheckedChange={(checked) => handleToggle(component.id, checked)}
                          disabled={busy || !!pendingAction}
                          data-testid={`switch-component-${component.id}`}
                        />
                      </TableCell>
                    </TableRow>,
                ];
                if (isExpanded) {
                  rows.push(
                    <TableRow
                      key={`${component.id}-expanded`}
                      data-testid={`row-component-detail-${component.id}`}
                      className="bg-muted/30 hover:bg-muted/30"
                    >
                        <TableCell colSpan={5} className="p-0">
                          <div className="p-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <Database className="h-4 w-4 text-muted-foreground" />
                                Tables
                              </div>
                              {tables.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {tables.map((table) => (
                                    <Badge
                                      key={table}
                                      variant="secondary"
                                      className="font-mono text-xs"
                                      data-testid={`badge-table-${component.id}-${table}`}
                                    >
                                      {table}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  This component does not manage any database tables.
                                </p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <Shield className="h-4 w-4 text-muted-foreground" />
                                Permissions
                              </div>
                              {permissions.length > 0 ? (
                                <ul className="space-y-2">
                                  {permissions.map((perm) => (
                                    <li
                                      key={perm.key}
                                      className="text-sm"
                                      data-testid={`row-permission-${component.id}-${perm.key}`}
                                    >
                                      <div
                                        className="font-mono text-xs"
                                        data-testid={`text-permission-key-${component.id}-${perm.key}`}
                                      >
                                        {perm.key}
                                      </div>
                                      <div
                                        className="text-muted-foreground"
                                        data-testid={`text-permission-description-${component.id}-${perm.key}`}
                                      >
                                        {perm.description}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  This component does not define any permissions.
                                </p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <Plug className="h-4 w-4 text-muted-foreground" />
                                Plugin Configs
                              </div>
                              {pluginConfigs.length > 0 ? (
                                <ul className="space-y-2">
                                  {pluginConfigs.map((pc) => (
                                    <li
                                      key={pc.siriusId}
                                      className="text-sm"
                                      data-testid={`row-plugin-config-${component.id}-${pc.siriusId}`}
                                    >
                                      <div
                                        className="font-medium"
                                        data-testid={`text-plugin-config-name-${component.id}-${pc.siriusId}`}
                                      >
                                        {pc.name ?? pc.siriusId}
                                      </div>
                                      <div
                                        className="font-mono text-xs text-muted-foreground"
                                        data-testid={`text-plugin-config-type-${component.id}-${pc.siriusId}`}
                                      >
                                        {pc.pluginKind}/{pc.pluginId}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  This component does not declare any plugin configs.
                                </p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <KeyRound className="h-4 w-4 text-muted-foreground" />
                                Environment Variables
                              </div>
                              {componentEnvVars.length > 0 ? (
                                <ul className="space-y-2">
                                  {componentEnvVars.map((v) => (
                                    <li
                                      key={v.name}
                                      className="text-sm"
                                      data-testid={`row-env-var-${component.id}-${v.name}`}
                                    >
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-mono text-xs">{v.name}</span>
                                        {v.secret && (
                                          <Badge variant="outline" className="text-xs">
                                            Secret
                                          </Badge>
                                        )}
                                        <Badge
                                          variant={v.isSet ? "secondary" : "outline"}
                                          className={
                                            v.isSet
                                              ? "text-xs"
                                              : "text-xs text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                                          }
                                          data-testid={`badge-env-var-set-${component.id}-${v.name}`}
                                        >
                                          {v.isSet ? "Set" : "Not set"}
                                        </Badge>
                                      </div>
                                      <div className="text-muted-foreground">
                                        {v.description}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  This component does not declare any environment variables.
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>,
                  );
                }
                return rows;
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!pendingAction} onOpenChange={(open) => !open && handleCancelAction()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingAction?.enabled ? (
                <>
                  <Database className="h-5 w-5" />
                  Enable {pendingAction?.component.name}
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Disable {pendingAction?.component.name}
                </>
              )}
            </DialogTitle>
            <DialogDescription asChild>
              {pendingAction?.enabled ? (
                <div className="space-y-3">
                  <p>Enabling this component will create the following database tables:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {pendingAction?.schemaInfo?.tables.map((table) => (
                      <li key={table} className="font-mono text-sm">{table}</li>
                    ))}
                  </ul>
                  {(pendingAction?.component.schemaManifest?.dependsOnComponents?.length ?? 0) > 0 && (
                    <p className="text-sm" data-testid="text-enable-dependencies">
                      Requires these components to be enabled first:{" "}
                      {pendingAction?.component.schemaManifest?.dependsOnComponents
                        ?.map((depId) => allComponents.find((c) => c.id === depId)?.name ?? depId)
                        .join(", ")}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    This component manages the following database tables:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    {pendingAction?.schemaInfo?.tables.map((table, idx) => (
                      <li key={table} className="font-mono text-sm">
                        {table}
                        {pendingAction?.schemaInfo?.tablesExist[idx] && (
                          <Badge variant="secondary" className="ml-2 text-xs">Contains Data</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                  
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-3">What should happen to the data?</p>
                    <RadioGroup
                      value={dataAction}
                      onValueChange={(value: "retain" | "delete") => {
                        setDataAction(value);
                        if (value === "retain") setConfirmText("");
                      }}
                      className="space-y-3"
                    >
                      <div className="flex items-start space-x-3 p-3 rounded-md border bg-muted/30">
                        <RadioGroupItem value="retain" id="retain" data-testid="radio-retain" />
                        <div className="flex-1">
                          <Label htmlFor="retain" className="flex items-center gap-2 font-medium cursor-pointer">
                            <Archive className="h-4 w-4 text-muted-foreground" />
                            Keep Tables
                          </Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            Tables and data will be preserved. You can re-enable this component later without losing data.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3 p-3 rounded-md border border-destructive/30 bg-destructive/5">
                        <RadioGroupItem value="delete" id="delete" data-testid="radio-delete" />
                        <div className="flex-1">
                          <Label htmlFor="delete" className="flex items-center gap-2 font-medium cursor-pointer text-destructive">
                            <Trash2 className="h-4 w-4" />
                            Delete Tables
                          </Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            All tables and data will be permanently deleted. This cannot be undone.
                          </p>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>

                  {dataAction === "delete" && (
                    <div className="pt-2 border-t">
                      <p className="text-sm mb-2 text-destructive font-medium">Type <strong>DELETE</strong> to confirm deletion:</p>
                      <Input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="Type DELETE"
                        data-testid="input-confirm-delete"
                      />
                    </div>
                  )}
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelAction} disabled={updateComponentMutation.isPending} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              variant={pendingAction?.enabled ? "default" : (dataAction === "delete" ? "destructive" : "default")}
              onClick={handleConfirmAction}
              disabled={busy || (!pendingAction?.enabled && dataAction === "delete" && confirmText !== "DELETE")}
              data-testid="button-confirm"
            >
              {updateComponentMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {pendingAction?.enabled 
                ? "Enable Component" 
                : (dataAction === "delete" ? "Delete Tables & Disable" : "Disable & Keep Tables")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
