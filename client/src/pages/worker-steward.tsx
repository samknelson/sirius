import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Loader2, Users, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { User, Role, Variable, RolePermission } from "@shared/schema";

const VARIABLE_NAME = "worker_steward_config";
const STEWARD_PERMISSION = "workers.steward";

interface StewardConfig {
  role: string | null;
}

function WorkerStewardContent() {
  const { worker, contact } = useWorkerLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isToggling, setIsToggling] = useState(false);

  const { data: configVariable, isLoading: configLoading } = useQuery<Variable | null>({
    queryKey: ["/api/variables/by-name", VARIABLE_NAME],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/variables/by-name/${VARIABLE_NAME}`);
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new Error("Failed to fetch steward config");
        }
        return response.json();
      } catch {
        return null;
      }
    },
  });

  const stewardConfig: StewardConfig | null = useMemo(() => {
    if (!configVariable?.value) return null;
    try {
      const parsed = typeof configVariable.value === 'string'
        ? JSON.parse(configVariable.value)
        : configVariable.value;
      return { role: parsed.role || null };
    } catch {
      return null;
    }
  }, [configVariable]);

  const { data: stewardRole, isLoading: roleLoading } = useQuery<Role | null>({
    queryKey: ["/api/admin/roles", stewardConfig?.role],
    queryFn: async () => {
      if (!stewardConfig?.role) return null;
      const response = await fetch(`/api/admin/roles`);
      if (!response.ok) return null;
      const roles: Role[] = await response.json();
      return roles.find(r => r.id === stewardConfig.role) || null;
    },
    enabled: !!stewardConfig?.role,
  });

  const { data: rolePermissions = [], isLoading: permissionsLoading } = useQuery<RolePermission[]>({
    queryKey: ["/api/admin/role-permissions"],
  });

  const roleHasStewardPermission = useMemo(() => {
    if (!stewardConfig?.role) return false;
    return rolePermissions.some(
      rp => rp.roleId === stewardConfig.role && rp.permissionKey === STEWARD_PERMISSION
    );
  }, [stewardConfig?.role, rolePermissions]);

  const contactEmail = contact?.email;

  const { data: linkedUser, isLoading: userLoading, error: userError } = useQuery<User | null>({
    queryKey: ["/api/admin/users/by-email", contactEmail],
    queryFn: async () => {
      if (!contactEmail) return null;
      const response = await fetch(`/api/admin/users/by-email/${encodeURIComponent(contactEmail)}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch user");
      }
      return response.json();
    },
    enabled: !!contactEmail,
  });

  const { data: userRoles = [], isLoading: userRolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/users", linkedUser?.id, "roles"],
    queryFn: async () => {
      if (!linkedUser?.id) return [];
      const response = await fetch(`/api/admin/users/${linkedUser.id}/roles`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!linkedUser?.id,
  });

  const hasStewardRole = useMemo(() => {
    if (!stewardConfig?.role || !userRoles.length) return false;
    return userRoles.some(r => r.id === stewardConfig.role);
  }, [stewardConfig?.role, userRoles]);

  const assignRoleMutation = useMutation({
    mutationFn: async () => {
      if (!linkedUser?.id || !stewardConfig?.role) {
        throw new Error("Missing user or role configuration");
      }
      return apiRequest("POST", `/api/admin/users/${linkedUser.id}/roles`, {
        roleId: stewardConfig.role,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", linkedUser?.id, "roles"] });
      toast({
        title: "Shop Steward Enabled",
        description: `${contact?.displayName || "Worker"} has been designated as a shop steward.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to enable shop steward status.",
        variant: "destructive",
      });
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: async () => {
      if (!linkedUser?.id || !stewardConfig?.role) {
        throw new Error("Missing user or role configuration");
      }
      return apiRequest("DELETE", `/api/admin/users/${linkedUser.id}/roles/${stewardConfig.role}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", linkedUser?.id, "roles"] });
      toast({
        title: "Shop Steward Disabled",
        description: `${contact?.displayName || "Worker"} is no longer designated as a shop steward.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to disable shop steward status.",
        variant: "destructive",
      });
    },
  });

  const handleToggle = async (checked: boolean) => {
    setIsToggling(true);
    try {
      if (checked) {
        await assignRoleMutation.mutateAsync();
      } else {
        await removeRoleMutation.mutateAsync();
      }
    } finally {
      setIsToggling(false);
    }
  };

  const isLoading = configLoading || roleLoading || userLoading || userRolesLoading || permissionsLoading;
  const isMutating = assignRoleMutation.isPending || removeRoleMutation.isPending || isToggling;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Shop Steward
          </CardTitle>
          <CardDescription>
            Manage shop steward designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-6 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (!stewardConfig?.role) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Shop Steward
          </CardTitle>
          <CardDescription>
            Manage shop steward designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-no-steward-role-configured">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Steward Role Not Configured</AlertTitle>
            <AlertDescription>
              No steward role has been configured. Please go to <strong>Config &gt; Workers &gt; Steward</strong> to 
              select a role for shop stewards before you can designate workers as stewards.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!roleHasStewardPermission) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Shop Steward
          </CardTitle>
          <CardDescription>
            Manage shop steward designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-role-missing-permission">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Configuration Issue</AlertTitle>
            <AlertDescription>
              The configured steward role "{stewardRole?.name || stewardConfig.role}" no longer has the 
              "workers.steward" permission. Please update the configuration in <strong>Config &gt; Workers &gt; Steward</strong>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!contactEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Shop Steward
          </CardTitle>
          <CardDescription>
            Manage shop steward designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-no-email">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No Email Address</AlertTitle>
            <AlertDescription>
              This worker's contact does not have an email address. An email address is required to link 
              a worker to a user account for shop steward designation.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!linkedUser) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Shop Steward
          </CardTitle>
          <CardDescription>
            Manage shop steward designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-no-user">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No User Account</AlertTitle>
            <AlertDescription>
              There is no user account associated with this worker's email address ({contactEmail}). 
              A user account must be created for this worker before they can be designated as a shop steward.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Shop Steward
        </CardTitle>
        <CardDescription>
          Manage shop steward designation for this worker
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-1">
            <Label htmlFor="steward-toggle" className="text-base font-medium">
              Shop Steward Status
            </Label>
            <p className="text-sm text-muted-foreground">
              {hasStewardRole 
                ? "This worker is currently designated as a shop steward"
                : "Enable to designate this worker as a shop steward"
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
            <Switch
              id="steward-toggle"
              checked={hasStewardRole}
              onCheckedChange={handleToggle}
              disabled={isMutating}
              data-testid="switch-steward-status"
            />
          </div>
        </div>

        {hasStewardRole && (
          <Alert data-testid="alert-steward-active">
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Active Shop Steward</AlertTitle>
            <AlertDescription>
              This worker has the "{stewardRole?.name}" role assigned to their user account, 
              granting them shop steward permissions.
            </AlertDescription>
          </Alert>
        )}

        <div className="text-sm text-muted-foreground space-y-1">
          <p><strong>Linked User:</strong> {linkedUser.email}</p>
          <p><strong>Steward Role:</strong> {stewardRole?.name || "Unknown"}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkerSteward() {
  return (
    <WorkerLayout activeTab="steward">
      <WorkerStewardContent />
    </WorkerLayout>
  );
}
