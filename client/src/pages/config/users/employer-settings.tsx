import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Briefcase, Info, Save } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Role {
  id: string;
  name: string;
  description: string | null;
  sequence: number;
}

interface EmployerUserSettingsResponse {
  required: string[];
  optional: string[];
}

export default function EmployerUserSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isInitialized = useRef(false);

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const { data, isLoading: settingsLoading } = useQuery<EmployerUserSettingsResponse>({
    queryKey: ["/api/employer-user-settings"],
  });

  const [requiredRoles, setRequiredRoles] = useState<string[]>([]);
  const [optionalRoles, setOptionalRoles] = useState<string[]>([]);

  useEffect(() => {
    if (!isInitialized.current && data) {
      setRequiredRoles(data.required);
      setOptionalRoles(data.optional);
      isInitialized.current = true;
    }
  }, [data]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: { required: string[]; optional: string[] }) => {
      return apiRequest("PUT", "/api/employer-user-settings", settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employer-user-settings"] });
      toast({
        title: "Settings Updated",
        description: "Employer user role settings have been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update employer user settings.",
        variant: "destructive",
      });
    },
  });

  const handleRequiredToggle = (roleId: string, checked: boolean) => {
    setRequiredRoles(prev => {
      if (checked) {
        // Remove from optional if it's there
        setOptionalRoles(opt => opt.filter(id => id !== roleId));
        return [...prev, roleId];
      } else {
        return prev.filter(id => id !== roleId);
      }
    });
  };

  const handleOptionalToggle = (roleId: string, checked: boolean) => {
    setOptionalRoles(prev => {
      if (checked) {
        // Remove from required if it's there
        setRequiredRoles(req => req.filter(id => id !== roleId));
        return [...prev, roleId];
      } else {
        return prev.filter(id => id !== roleId);
      }
    });
  };

  const handleSave = () => {
    updateSettingsMutation.mutate({
      required: requiredRoles,
      optional: optionalRoles,
    });
  };

  const hasChanges = 
    JSON.stringify([...requiredRoles].sort()) !== JSON.stringify([...(data?.required || [])].sort()) ||
    JSON.stringify([...optionalRoles].sort()) !== JSON.stringify([...(data?.optional || [])].sort());

  const isLoading = rolesLoading || settingsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Employer User Settings
          </h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  // Sort roles by sequence
  const sortedRoles = [...roles].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Employer User Settings
          </h1>
          <p className="text-muted-foreground mt-2">
            Configure which roles are required or optional for employer users
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateSettingsMutation.isPending}
          data-testid="button-save-employer-settings"
        >
          <Save className="h-4 w-4 mr-2" />
          {updateSettingsMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Required roles will be automatically assigned to employer users.
          Optional roles can be assigned manually as needed.
          A role cannot be both required and optional - selecting one will deselect the other.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Briefcase className="h-5 w-5 mr-2" />
              Required Employer Roles
            </CardTitle>
            <CardDescription>
              These roles will be automatically assigned to all employer users
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sortedRoles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                >
                  <Checkbox
                    id={`required-${role.id}`}
                    checked={requiredRoles.includes(role.id)}
                    onCheckedChange={(checked) => handleRequiredToggle(role.id, checked as boolean)}
                    data-testid={`checkbox-required-role-${role.id}`}
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`required-${role.id}`}
                      className="font-medium cursor-pointer"
                    >
                      {role.name}
                    </Label>
                    {role.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {role.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {sortedRoles.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No roles available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Briefcase className="h-5 w-5 mr-2" />
              Optional Employer Roles
            </CardTitle>
            <CardDescription>
              These roles can be manually assigned to employer users as needed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sortedRoles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                >
                  <Checkbox
                    id={`optional-${role.id}`}
                    checked={optionalRoles.includes(role.id)}
                    onCheckedChange={(checked) => handleOptionalToggle(role.id, checked as boolean)}
                    data-testid={`checkbox-optional-role-${role.id}`}
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`optional-${role.id}`}
                      className="font-medium cursor-pointer"
                    >
                      {role.name}
                    </Label>
                    {role.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {role.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {sortedRoles.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No roles available
                </div>
              )}
            </div>
          </CardContent>
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
