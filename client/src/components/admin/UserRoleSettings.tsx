import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Info, Save } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import type { Role } from "@/lib/entity-types";

interface VariableResponse {
  value: unknown;
}

interface RoleSettings {
  required: string[];
  optional: string[];
}

interface UserRoleSettingsProps {
  subject: string;
  subjectPlural: string;
  requiredVariable: string;
  optionalVariable: string;
  icon: LucideIcon;
  testIdPrefix: string;
}

async function getRoleVariable(name: string): Promise<string[]> {
  const response = await fetch(`/api/variables/by-name/${encodeURIComponent(name)}`, {
    credentials: "include",
  });

  if (response.status === 404) return [];
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Failed to load ${name}`);
  }

  const variable = await response.json() as VariableResponse;
  return Array.isArray(variable.value)
    ? variable.value.filter((value): value is string => typeof value === "string")
    : [];
}

function sameIds(left: string[], right: string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export default function UserRoleSettings({
  subject,
  subjectPlural,
  requiredVariable,
  optionalVariable,
  icon: Icon,
  testIdPrefix,
}: UserRoleSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const initialized = useRef(false);
  const settingsQueryKey = ["user-role-settings", requiredVariable, optionalVariable] as const;

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });
  const { data, isLoading: settingsLoading } = useQuery<RoleSettings>({
    queryKey: settingsQueryKey,
    queryFn: async () => {
      const [required, optional] = await Promise.all([
        getRoleVariable(requiredVariable),
        getRoleVariable(optionalVariable),
      ]);
      return { required, optional };
    },
  });

  const [requiredRoles, setRequiredRoles] = useState<string[]>([]);
  const [optionalRoles, setOptionalRoles] = useState<string[]>([]);

  useEffect(() => {
    if (data && !initialized.current) {
      setRequiredRoles(data.required);
      setOptionalRoles(data.optional);
      initialized.current = true;
    }
  }, [data]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: RoleSettings) => {
      await apiRequest("PUT", `/api/variables/by-name/${encodeURIComponent(requiredVariable)}`, {
        value: settings.required,
      });
      try {
        await apiRequest("PUT", `/api/variables/by-name/${encodeURIComponent(optionalVariable)}`, {
          value: settings.optional,
        });
      } catch (error) {
        throw new Error(
          `Required roles were saved, but optional roles were not: ${getApiErrorMessage(error, "unknown error")}`,
        );
      }
      return settings;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsQueryKey, settings);
      toast({
        title: "Settings Updated",
        description: `${subject} role settings have been updated successfully.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: getApiErrorMessage(error, `Failed to update ${subject.toLowerCase()} role settings.`),
        variant: "destructive",
      });
    },
  });

  const handleRequiredToggle = (roleId: string, checked: boolean) => {
    setRequiredRoles((current) => {
      if (!checked) return current.filter((id) => id !== roleId);
      setOptionalRoles((optional) => optional.filter((id) => id !== roleId));
      return current.includes(roleId) ? current : [...current, roleId];
    });
  };

  const handleOptionalToggle = (roleId: string, checked: boolean) => {
    setOptionalRoles((current) => {
      if (!checked) return current.filter((id) => id !== roleId);
      setRequiredRoles((required) => required.filter((id) => id !== roleId));
      return current.includes(roleId) ? current : [...current, roleId];
    });
  };

  const hasChanges = !sameIds(requiredRoles, data?.required ?? [])
    || !sameIds(optionalRoles, data?.optional ?? []);
  const sortedRoles = [...roles].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  if (rolesLoading || settingsLoading) {
    return <p className="py-8 text-muted-foreground">Loading {subject.toLowerCase()} role settings...</p>;
  }

  const renderRoleList = (kind: "required" | "optional") => {
    const selected = kind === "required" ? requiredRoles : optionalRoles;
    const toggle = kind === "required" ? handleRequiredToggle : handleOptionalToggle;

    return (
      <div className="space-y-4">
        {sortedRoles.map((role) => {
          const id = `${testIdPrefix}-${kind}-${role.id}`;
          return (
            <div
              key={role.id}
              className="flex items-start space-x-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              <Checkbox
                id={id}
                checked={selected.includes(role.id)}
                onCheckedChange={(checked) => toggle(role.id, checked === true)}
                data-testid={`checkbox-${testIdPrefix}-${kind}-role-${role.id}`}
              />
              <div className="flex-1">
                <Label htmlFor={id} className="cursor-pointer font-medium">
                  {role.name}
                </Label>
                {role.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                )}
              </div>
            </div>
          );
        })}
        {sortedRoles.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">No roles available</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{subject} Role Settings</h2>
          <p className="mt-1 text-muted-foreground">
            Configure which roles are required or optional for {subjectPlural.toLowerCase()}
          </p>
        </div>
        <Button
          onClick={() => updateSettingsMutation.mutate({ required: requiredRoles, optional: optionalRoles })}
          disabled={!hasChanges || updateSettingsMutation.isPending}
          data-testid={`button-save-${testIdPrefix}-settings`}
        >
          <Save className="mr-2 h-4 w-4" />
          {updateSettingsMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Required roles are automatically assigned to {subjectPlural.toLowerCase()}. Optional roles can be
          assigned manually. A role cannot be both required and optional.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon className="h-5 w-5" />
              Required {subject} Roles
            </CardTitle>
            <CardDescription>
              Automatically assigned to all {subjectPlural.toLowerCase()}
            </CardDescription>
          </CardHeader>
          <CardContent>{renderRoleList("required")}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon className="h-5 w-5" />
              Optional {subject} Roles
            </CardTitle>
            <CardDescription>
              Available for manual assignment to {subjectPlural.toLowerCase()}
            </CardDescription>
          </CardHeader>
          <CardContent>{renderRoleList("optional")}</CardContent>
        </Card>
      </div>

      {hasChanges && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            You have unsaved changes. Click "Save Changes" to apply your selections.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}