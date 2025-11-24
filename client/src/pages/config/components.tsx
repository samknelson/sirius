import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getAllComponents, ComponentDefinition, ComponentConfig } from "@shared/components";

export default function ComponentsConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const allComponents = getAllComponents();

  const { data: componentConfigs = [], isLoading } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
  });

  const [localStates, setLocalStates] = useState<Record<string, boolean>>({});
  const isInitialized = useRef(false);

  useEffect(() => {
    // Initialize local states from configs or defaults only once
    if (!isInitialized.current && componentConfigs.length > 0) {
      const states: Record<string, boolean> = {};
      allComponents.forEach((component: ComponentDefinition) => {
        const config = componentConfigs.find(c => c.componentId === component.id);
        states[component.id] = config ? config.enabled : component.enabledByDefault;
      });
      setLocalStates(states);
      isInitialized.current = true;
    }
  }, [componentConfigs, allComponents]);

  const updateComponentMutation = useMutation({
    mutationFn: async ({ componentId, enabled }: { componentId: string; enabled: boolean }) => {
      return apiRequest("PUT", `/api/components/config/${componentId}`, { enabled });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/components/config"] });
      toast({
        title: "Component Updated",
        description: `Component ${variables.enabled ? "enabled" : "disabled"} successfully.`,
      });
    },
    onError: (error: any, variables) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update component.",
        variant: "destructive",
      });
      // Revert local state on error
      setLocalStates(prev => ({
        ...prev,
        [variables.componentId]: !variables.enabled,
      }));
    },
  });

  const handleToggle = (componentId: string, enabled: boolean) => {
    // Optimistic update
    setLocalStates(prev => ({
      ...prev,
      [componentId]: enabled,
    }));
    
    updateComponentMutation.mutate({ componentId, enabled });
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
                  <TableCell className="font-mono text-sm">{component.id}</TableCell>
                  <TableCell className="font-medium">{component.name}</TableCell>
                  <TableCell className="text-muted-foreground">{component.description}</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      id={`component-${component.id}`}
                      checked={localStates[component.id] || false}
                      onCheckedChange={(checked) => handleToggle(component.id, checked)}
                      data-testid={`switch-component-${component.id}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
