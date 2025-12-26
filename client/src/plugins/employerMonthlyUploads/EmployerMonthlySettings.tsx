import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Building2, Info, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmployerMonthlyPluginConfig } from "@shared/schema";
import { PluginSettingsProps } from "../types";
import { Role } from "@/lib/entity-types";
import { WizardType } from "@/lib/wizard-types";

export function EmployerMonthlySettings({ plugin, queryClient, onConfigSaved, loadSettings, saveSettings }: PluginSettingsProps<EmployerMonthlyPluginConfig>) {
  const { toast } = useToast();

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const { data: wizardTypes = [], isLoading: wizardTypesLoading } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const { data: pluginConfig = {}, isLoading: configLoading } = useQuery<EmployerMonthlyPluginConfig>({
    queryKey: [`/api/dashboard-plugins/${plugin.id}/settings`],
    queryFn: loadSettings,
  });

  const [localConfig, setLocalConfig] = useState<EmployerMonthlyPluginConfig>({});

  useEffect(() => {
    setLocalConfig(pluginConfig);
  }, [pluginConfig]);

  const monthlyWizardTypes = wizardTypes.filter(wt => wt.isMonthly === true);

  const updateConfigMutation = useMutation({
    mutationFn: async (config: EmployerMonthlyPluginConfig) => {
      await saveSettings(config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/dashboard-plugins/${plugin.id}/settings`] });
      toast({
        title: "Configuration Updated",
        description: "Employer Monthly plugin configuration has been saved successfully.",
      });
      onConfigSaved?.();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update configuration.",
        variant: "destructive",
      });
    },
  });

  const handleToggleWizardType = (roleId: string, wizardTypeName: string, checked: boolean) => {
    setLocalConfig(prev => {
      const roleTypes = prev[roleId] || [];
      
      if (checked) {
        // Add wizard type if not already present
        if (!roleTypes.includes(wizardTypeName)) {
          return {
            ...prev,
            [roleId]: [...roleTypes, wizardTypeName],
          };
        }
      } else {
        // Remove wizard type
        return {
          ...prev,
          [roleId]: roleTypes.filter(type => type !== wizardTypeName),
        };
      }
      
      return prev;
    });
  };

  const handleSave = () => {
    updateConfigMutation.mutate(localConfig);
  };

  const isLoading = rolesLoading || wizardTypesLoading || configLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Employer Monthly Plugin
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
          Employer Monthly Plugin
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure which wizard types are visible to each role on the Employer Monthly Uploads dashboard plugin.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Select which monthly wizard types should be displayed for each role. Users with multiple roles will see all wizard types configured for their roles.
        </AlertDescription>
      </Alert>

      {monthlyWizardTypes.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No monthly wizard types are available. Monthly wizard types must be configured before assigning them to roles.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="space-y-4">
            {roles.map((role) => {
              const roleTypes = localConfig[role.id] || [];
              
              return (
                <Card key={role.id} data-testid={`card-role-${role.id}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      {role.name}
                    </CardTitle>
                    {role.description && (
                      <CardDescription>{role.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Available Monthly Wizard Types</Label>
                      {monthlyWizardTypes.map((wizardType) => {
                        const isChecked = roleTypes.includes(wizardType.name);
                        
                        return (
                          <div 
                            key={wizardType.name} 
                            className="flex items-center space-x-2"
                            data-testid={`wizard-type-${role.id}-${wizardType.name}`}
                          >
                            <Checkbox
                              id={`${role.id}-${wizardType.name}`}
                              checked={isChecked}
                              onCheckedChange={(checked) => 
                                handleToggleWizardType(role.id, wizardType.name, checked as boolean)
                              }
                              data-testid={`checkbox-${role.id}-${wizardType.name}`}
                            />
                            <Label 
                              htmlFor={`${role.id}-${wizardType.name}`}
                              className="text-sm cursor-pointer"
                            >
                              <div className="font-medium">{wizardType.displayName}</div>
                              {wizardType.description && (
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {wizardType.description}
                                </div>
                              )}
                            </Label>
                          </div>
                        );
                      })}
                      {roleTypes.length === 0 && (
                        <p className="text-sm text-muted-foreground italic">
                          No wizard types configured for this role
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={updateConfigMutation.isPending}
              data-testid="button-save-config"
            >
              <Save className="h-4 w-4 mr-2" />
              {updateConfigMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </>
      )}

      {roles.length === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No roles are configured. Create roles first before configuring the Employer Monthly plugin.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
