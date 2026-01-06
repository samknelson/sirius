import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Loader2, Save, Users, AlertTriangle } from "lucide-react";
import { Variable, RolePermission } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Role } from "@/lib/entity-types";

const VARIABLE_NAME = "worker_steward_config";
const STEWARD_PERMISSION = "worker.steward";

interface StewardConfig {
  role: string | null;
}

const DEFAULT_CONFIG: StewardConfig = {
  role: null,
};

export default function StewardSettingsPage() {
  usePageTitle("Steward Settings");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<StewardConfig>(DEFAULT_CONFIG);

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const { data: rolePermissions = [], isLoading: permissionsLoading } = useQuery<RolePermission[]>({
    queryKey: ["/api/admin/role-permissions"],
  });

  const eligibleRoles = useMemo(() => {
    const rolesWithStewardPermission = new Set(
      rolePermissions
        .filter(rp => rp.permissionKey === STEWARD_PERMISSION)
        .map(rp => rp.roleId)
    );
    return roles.filter(role => rolesWithStewardPermission.has(role.id));
  }, [roles, rolePermissions]);

  const { data: configVariable, isLoading: variableLoading } = useQuery<Variable | null>({
    queryKey: ["/api/variables/by-name", VARIABLE_NAME],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/variables/by-name/${VARIABLE_NAME}`);
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new Error("Failed to fetch steward config variable");
        }
        return response.json();
      } catch {
        return null;
      }
    },
  });

  useEffect(() => {
    if (configVariable?.value) {
      try {
        const parsed = typeof configVariable.value === 'string' 
          ? JSON.parse(configVariable.value) 
          : configVariable.value;
        setConfig({
          role: parsed.role || null,
        });
      } catch {
        setConfig(DEFAULT_CONFIG);
      }
    }
  }, [configVariable]);

  const saveMutation = useMutation({
    mutationFn: async (newConfig: StewardConfig) => {
      const jsonValue = JSON.stringify(newConfig);
      if (configVariable) {
        return apiRequest("PUT", `/api/variables/${configVariable.id}`, {
          value: jsonValue,
        });
      } else {
        return apiRequest("POST", "/api/variables", {
          name: VARIABLE_NAME,
          value: jsonValue,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name", VARIABLE_NAME] });
      toast({
        title: "Success",
        description: "Steward settings have been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save steward settings.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(config);
  };

  const getCurrentConfig = (): StewardConfig => {
    if (configVariable?.value) {
      try {
        const parsed = typeof configVariable.value === 'string'
          ? JSON.parse(configVariable.value)
          : configVariable.value;
        return {
          role: parsed.role || null,
        };
      } catch {
        return DEFAULT_CONFIG;
      }
    }
    return DEFAULT_CONFIG;
  };

  const hasChanges = JSON.stringify(config) !== JSON.stringify(getCurrentConfig());

  const isLoading = rolesLoading || variableLoading || permissionsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const selectedRole = eligibleRoles.find(r => r.id === config.role);
  const noEligibleRoles = eligibleRoles.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="heading-steward-settings">
          Steward Settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure settings for shop steward functionality
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Steward Role Configuration
          </CardTitle>
          <CardDescription>
            Select the role that will be assigned to workers designated as shop stewards
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {noEligibleRoles ? (
            <Alert variant="destructive" data-testid="alert-no-eligible-roles">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No Eligible Roles Found</AlertTitle>
              <AlertDescription>
                No roles have been assigned the "worker.steward" permission. To configure a steward role, 
                first go to <strong>Config &gt; Users &gt; Roles</strong> and assign the "worker.steward" 
                permission to at least one role.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="steward-role">Steward Role</Label>
                <Select
                  value={config.role || ""}
                  onValueChange={(value) => setConfig({ ...config, role: value || null })}
                >
                  <SelectTrigger id="steward-role" data-testid="select-steward-role">
                    <SelectValue placeholder="Select a role..." />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id} data-testid={`option-role-${role.id}`}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedRole?.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedRole.description}
                  </p>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || saveMutation.isPending}
                  data-testid="button-save-steward-settings"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Settings
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
