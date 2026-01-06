import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Loader2, Users, CheckCircle, Plus, Trash2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { User, Role, Variable, RolePermission, BargainingUnit, Employer, WorkerStewardAssignment } from "@shared/schema";
import { useTerm } from "@/contexts/TerminologyContext";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const VARIABLE_NAME = "worker_steward_config";
const STEWARD_PERMISSION = "worker.steward";
const NONE_VALUE = "__none__";

interface StewardConfig {
  role: string | null;
}

interface WorkerStewardAssignmentWithDetails extends WorkerStewardAssignment {
  employer?: { id: string; name: string };
  bargainingUnit?: { id: string; name: string };
}

function StewardAssignmentsSection() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const term = useTerm();
  const [isAddingAssignment, setIsAddingAssignment] = useState(false);
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>(
    worker.denormHomeEmployerId || NONE_VALUE
  );
  const [selectedBargainingUnitId, setSelectedBargainingUnitId] = useState<string>(
    worker.bargainingUnitId || NONE_VALUE
  );
  const [deleteAssignmentId, setDeleteAssignmentId] = useState<string | null>(null);

  const { data: assignments = [], isLoading: isLoadingAssignments } = useQuery<WorkerStewardAssignmentWithDetails[]>({
    queryKey: ["/api/workers", worker.id, "steward-assignments"],
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers/lookup"],
  });

  const { data: bargainingUnits = [] } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { employerId: string; bargainingUnitId: string }) => {
      return await apiRequest("POST", `/api/workers/${worker.id}/steward-assignments`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "steward-assignments"] });
      setIsAddingAssignment(false);
      setSelectedEmployerId(worker.denormHomeEmployerId || NONE_VALUE);
      setSelectedBargainingUnitId(worker.bargainingUnitId || NONE_VALUE);
      toast({
        title: "Success",
        description: `${term("steward")} assignment added successfully`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to add ${term("steward", { lowercase: true })} assignment`,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return await apiRequest("DELETE", `/api/workers/${worker.id}/steward-assignments/${assignmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "steward-assignments"] });
      setDeleteAssignmentId(null);
      toast({
        title: "Success",
        description: `${term("steward")} assignment removed successfully`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to remove ${term("steward", { lowercase: true })} assignment`,
        variant: "destructive",
      });
    },
  });

  const handleAddAssignment = () => {
    if (selectedEmployerId === NONE_VALUE || selectedBargainingUnitId === NONE_VALUE) {
      toast({
        title: "Error",
        description: "Please select both an employer and a bargaining unit",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      employerId: selectedEmployerId,
      bargainingUnitId: selectedBargainingUnitId,
    });
  };

  const handleCancelAdd = () => {
    setIsAddingAssignment(false);
    setSelectedEmployerId(worker.denormHomeEmployerId || NONE_VALUE);
    setSelectedBargainingUnitId(worker.bargainingUnitId || NONE_VALUE);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>{term("steward")} Assignments</CardTitle>
          <CardDescription>
            Manage the employer and bargaining unit combinations this worker is a {term("steward", { lowercase: true })} for
          </CardDescription>
        </div>
        {!isAddingAssignment && (
          <Button
            onClick={() => setIsAddingAssignment(true)}
            size="sm"
            data-testid="button-add-steward-assignment"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Assignment
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isAddingAssignment && (
          <div className="border rounded-md p-4 space-y-4 bg-muted/30">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employer</Label>
                <Select
                  value={selectedEmployerId}
                  onValueChange={setSelectedEmployerId}
                >
                  <SelectTrigger data-testid="select-assignment-employer">
                    <SelectValue placeholder="Select an employer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>(Select an employer)</SelectItem>
                    {employers.map((employer) => (
                      <SelectItem key={employer.id} value={employer.id}>
                        {employer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bargaining Unit</Label>
                <Select
                  value={selectedBargainingUnitId}
                  onValueChange={setSelectedBargainingUnitId}
                >
                  <SelectTrigger data-testid="select-assignment-bargaining-unit">
                    <SelectValue placeholder="Select a bargaining unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>(Select a bargaining unit)</SelectItem>
                    {bargainingUnits.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleAddAssignment}
                disabled={createMutation.isPending || selectedEmployerId === NONE_VALUE || selectedBargainingUnitId === NONE_VALUE}
                data-testid="button-save-steward-assignment"
              >
                {createMutation.isPending ? "Adding..." : "Add"}
              </Button>
              <Button
                variant="outline"
                onClick={handleCancelAdd}
                data-testid="button-cancel-steward-assignment"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoadingAssignments ? (
          <p className="text-muted-foreground text-sm">Loading assignments...</p>
        ) : assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-no-steward-assignments">
            No {term("steward", { lowercase: true })} assignments yet. Click &ldquo;Add Assignment&rdquo; to create one.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employer</TableHead>
                <TableHead>Bargaining Unit</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => (
                <TableRow key={assignment.id} data-testid={`row-steward-assignment-${assignment.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{assignment.employer?.name || "Unknown Employer"}</span>
                      {assignment.employer?.id && (
                        <Link href={`/employers/${assignment.employer.id}`}>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{assignment.bargainingUnit?.name || "Unknown Unit"}</span>
                      {assignment.bargainingUnit?.id && (
                        <Link href={`/bargaining-units/${assignment.bargainingUnit.id}`}>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteAssignmentId(assignment.id)}
                      data-testid={`button-delete-steward-assignment-${assignment.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <AlertDialog open={!!deleteAssignmentId} onOpenChange={() => setDeleteAssignmentId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {term("steward")} Assignment</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove this {term("steward", { lowercase: true })} assignment? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-assignment">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteAssignmentId && deleteMutation.mutate(deleteAssignmentId)}
                data-testid="button-confirm-delete-assignment"
              >
                {deleteMutation.isPending ? "Removing..." : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function WorkerStewardContent() {
  const { worker, contact } = useWorkerLayout();
  const { toast } = useToast();
  const term = useTerm();
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
        title: `${term("steward")} Enabled`,
        description: `${contact?.displayName || "Worker"} has been designated as a ${term("steward", { lowercase: true })}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to enable ${term("steward", { lowercase: true })} status.`,
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
        title: `${term("steward")} Disabled`,
        description: `${contact?.displayName || "Worker"} is no longer designated as a ${term("steward", { lowercase: true })}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to disable ${term("steward", { lowercase: true })} status.`,
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
            {term("steward")}
          </CardTitle>
          <CardDescription>
            Manage {term("steward", { lowercase: true })} designation for this worker
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
            {term("steward")}
          </CardTitle>
          <CardDescription>
            Manage {term("steward", { lowercase: true })} designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-no-steward-role-configured">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{term("steward")} Role Not Configured</AlertTitle>
            <AlertDescription>
              No {term("steward", { lowercase: true })} role has been configured. Please go to <strong>Config &gt; Workers &gt; {term("steward")}</strong> to 
              select a role for {term("steward", { plural: true, lowercase: true })} before you can designate workers as {term("steward", { plural: true, lowercase: true })}.
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
            {term("steward")}
          </CardTitle>
          <CardDescription>
            Manage {term("steward", { lowercase: true })} designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-role-missing-permission">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Configuration Issue</AlertTitle>
            <AlertDescription>
              The configured {term("steward", { lowercase: true })} role &ldquo;{stewardRole?.name || stewardConfig.role}&rdquo; no longer has the 
              &ldquo;worker.steward&rdquo; permission. Please update the configuration in <strong>Config &gt; Workers &gt; {term("steward")}</strong>.
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
            {term("steward")}
          </CardTitle>
          <CardDescription>
            Manage {term("steward", { lowercase: true })} designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-no-email">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No Email Address</AlertTitle>
            <AlertDescription>
              This worker's contact does not have an email address. An email address is required to link 
              a worker to a user account for {term("steward", { lowercase: true })} designation.
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
            {term("steward")}
          </CardTitle>
          <CardDescription>
            Manage {term("steward", { lowercase: true })} designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-no-user">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No User Account</AlertTitle>
            <AlertDescription>
              There is no user account associated with this worker's email address ({contactEmail}). 
              A user account must be created for this worker before they can be designated as a {term("steward", { lowercase: true })}.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {term("steward")}
          </CardTitle>
          <CardDescription>
            Manage {term("steward", { lowercase: true })} designation for this worker
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <Label htmlFor="steward-toggle" className="text-base font-medium">
                {term("steward")} Status
              </Label>
              <p className="text-sm text-muted-foreground">
                {hasStewardRole 
                  ? `This worker is currently designated as a ${term("steward", { lowercase: true })}`
                  : `Enable to designate this worker as a ${term("steward", { lowercase: true })}`
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
              <AlertTitle>Active {term("steward")}</AlertTitle>
              <AlertDescription>
                This worker has the &ldquo;{stewardRole?.name}&rdquo; role assigned to their user account, 
                granting them {term("steward", { lowercase: true })} permissions.
              </AlertDescription>
            </Alert>
          )}

          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>Linked User:</strong> {linkedUser.email}</p>
            <p><strong>{term("steward")} Role:</strong> {stewardRole?.name || "Unknown"}</p>
          </div>
        </CardContent>
      </Card>

      <StewardAssignmentsSection />
    </div>
  );
}

export default function WorkerSteward() {
  return (
    <WorkerLayout activeTab="steward">
      <WorkerStewardContent />
    </WorkerLayout>
  );
}
