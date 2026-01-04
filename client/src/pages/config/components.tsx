import { useState, useEffect, useMemo } from "react";
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
import { Info, Database, AlertTriangle, Loader2, Archive, Trash2, Shield } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getAllComponents, ComponentDefinition, ComponentConfig } from "@shared/components";
import { usePageTitle } from "@/contexts/PageTitleContext";

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
  
  const allComponents = useMemo(() => getAllComponents(), []);

  const { data: componentConfigs = [], isLoading, isFetching } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
  });

  const [localStates, setLocalStates] = useState<Record<string, boolean>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [isCheckingSchema, setIsCheckingSchema] = useState(false);
  const [dataAction, setDataAction] = useState<"retain" | "delete">("retain");

  const updateComponentMutation = useMutation({
    mutationFn: async ({ componentId, enabled, confirmDestructive, retainData }: { componentId: string; enabled: boolean; confirmDestructive?: string; retainData?: boolean }) => {
      return apiRequest("PUT", `/api/components/config/${componentId}`, { enabled, confirmDestructive, retainData });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/components/config"] });
      toast({
        title: "Component Updated",
        description: `Component ${variables.enabled ? "enabled" : "disabled"} successfully.`,
      });
      setPendingAction(null);
      setConfirmText("");
      setDataAction("retain");
    },
    onError: (error: any, variables) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update component.",
        variant: "destructive",
      });
      setLocalStates(prev => ({
        ...prev,
        [variables.componentId]: !variables.enabled,
      }));
      setPendingAction(null);
      setConfirmText("");
      setDataAction("retain");
    },
  });

  useEffect(() => {
    if (!updateComponentMutation.isPending && !isFetching) {
      const states: Record<string, boolean> = {};
      allComponents.forEach((component: ComponentDefinition) => {
        const config = componentConfigs.find(c => c.componentId === component.id);
        states[component.id] = config ? config.enabled : component.enabledByDefault;
      });
      setLocalStates(states);
    }
  }, [componentConfigs, allComponents, updateComponentMutation.isPending, isFetching]);

  const handleToggle = async (componentId: string, enabled: boolean) => {
    const component = allComponents.find(c => c.id === componentId);
    if (!component) return;

    if (component.managesSchema) {
      setIsCheckingSchema(true);
      try {
        const response = await fetch(`/api/components/${componentId}/schema-info`);
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
        console.error("Failed to fetch schema info:", error);
      }
      setIsCheckingSchema(false);
    }

    setLocalStates(prev => ({ ...prev, [componentId]: enabled }));
    updateComponentMutation.mutate({ componentId, enabled });
  };

  const handleConfirmAction = () => {
    if (!pendingAction) return;

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

    setLocalStates(prev => ({ ...prev, [pendingAction.componentId]: pendingAction.enabled }));
    updateComponentMutation.mutate({
      componentId: pendingAction.componentId,
      enabled: pendingAction.enabled,
      retainData: !isDeleting,
      confirmDestructive: isDisabling && hasActiveTables && isDeleting ? "DELETE" : undefined,
    });
  };

  const handleCancelAction = () => {
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
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

      {sortedComponents.length === 0 ? (
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
                <TableHead>Component ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedComponents.map((component) => (
                <TableRow key={component.id} data-testid={`row-component-${component.id}`}>
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
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{component.name}</TableCell>
                  <TableCell className="text-muted-foreground">{component.description}</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      id={`component-${component.id}`}
                      checked={localStates[component.id] || false}
                      onCheckedChange={(checked) => handleToggle(component.id, checked)}
                      disabled={isCheckingSchema}
                      data-testid={`switch-component-${component.id}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
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
            <Button variant="outline" onClick={handleCancelAction} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              variant={pendingAction?.enabled ? "default" : (dataAction === "delete" ? "destructive" : "default")}
              onClick={handleConfirmAction}
              disabled={updateComponentMutation.isPending || (!pendingAction?.enabled && dataAction === "delete" && confirmText !== "DELETE")}
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
