import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Package, Info } from "lucide-react";
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

  // Group components by category
  const componentsByCategory: Record<string, ComponentDefinition[]> = {};
  allComponents.forEach((component: ComponentDefinition) => {
    const category = component.category || 'other';
    if (!componentsByCategory[category]) {
      componentsByCategory[category] = [];
    }
    componentsByCategory[category].push(component);
  });

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

      {Object.entries(componentsByCategory).map(([category, components]) => (
        <div key={category} className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 capitalize">
            {category.replace('-', ' ')}
          </h2>
          {components.map((component) => (
            <Card key={component.id} data-testid={`card-component-${component.id}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    {component.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`component-${component.id}`} className="text-sm font-normal">
                      {localStates[component.id] ? "Enabled" : "Disabled"}
                    </Label>
                    <Switch
                      id={`component-${component.id}`}
                      checked={localStates[component.id] || false}
                      onCheckedChange={(checked) => handleToggle(component.id, checked)}
                      data-testid={`switch-component-${component.id}`}
                    />
                  </div>
                </CardTitle>
                <CardDescription>{component.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <div>
                  <span className="font-medium">Component ID:</span> {component.id}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ))}

      {allComponents.length === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No components are registered. Add components to the registry to see them here.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
