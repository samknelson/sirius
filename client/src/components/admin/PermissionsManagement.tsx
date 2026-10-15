import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Key, Shield, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Role } from '@/lib/entity-types';

export interface Permission {
  key: string;
  description: string;
  module?: string;
}

export interface RolePermission {
  roleId: string;
  permissionKey: string;
  assignedAt: string;
  role: Role;
}

export function getPermissionsForRole(
  roleId: string,
  rolePermissions: RolePermission[],
): string[] {
  return rolePermissions
    .filter((rolePermission) => rolePermission.roleId === roleId)
    .map((rolePermission) => rolePermission.permissionKey);
}

export function getAvailablePermissions(
  permissions: Permission[],
  rolePermissions: RolePermission[],
  selectedRoleId: string,
): Permission[] {
  const assignedPermissionKeys = new Set(getPermissionsForRole(selectedRoleId, rolePermissions));
  const available = selectedRoleId
    ? permissions.filter(
        (permission) => !assignedPermissionKeys.has(permission.key),
      )
    : permissions;

  return [...available].sort((a, b) => a.key.localeCompare(b.key));
}

export function getNextPermissionSelection(
  selectedKeys: string[],
  permissionKey: string,
  checked: boolean,
): string[] {
  return checked
    ? Array.from(new Set([...selectedKeys, permissionKey]))
    : selectedKeys.filter((key) => key !== permissionKey);
}

export function getNextAllPermissionSelection(
  selectedKeys: string[],
  availablePermissions: Permission[],
  checked: boolean,
): string[] {
  const availableKeys = availablePermissions.map(({ key }) => key);
  return checked
    ? Array.from(new Set([...selectedKeys, ...availableKeys]))
    : selectedKeys.filter((key) => !availableKeys.includes(key));
}

export function getAssignedRoles(
  permissionKey: string,
  rolePermissions: RolePermission[],
): Role[] {
  return rolePermissions
    .filter((rolePermission) => rolePermission.permissionKey === permissionKey)
    .map((rolePermission) => rolePermission.role);
}

export default function PermissionsManagement() {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState<string[]>([]);
  const { toast } = useToast();

  // Fetch available permissions from registry
  const { data: permissions = [], isLoading: permissionsLoading } = useQuery<Permission[]>({
    queryKey: ['/api/admin/permissions'],
  });

  // Fetch available roles
  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ['/api/admin/roles'],
  });

  // Fetch current role-permission assignments
  const { data: rolePermissions = [], isLoading: assignmentsLoading } = useQuery<RolePermission[]>({
    queryKey: ['/api/admin/role-permissions'],
  });

  const assignPermissionsMutation = useMutation({
    mutationFn: async ({ roleId, permissionKeys }: { roleId: string; permissionKeys: string[] }) => {
      return await apiRequest('POST', `/api/admin/roles/${roleId}/permissions/bulk`, { permissionKeys });
    },
    onSuccess: async (result, { permissionKeys }) => {
      await queryClient.invalidateQueries({ queryKey: ['/api/admin/role-permissions'] });
      setSelectedPermissionKeys([]);
      toast({
        title: 'Success',
        description: result?.message || `${result?.assignments?.length ?? permissionKeys.length} permission(s) assigned successfully`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to assign permissions',
        variant: 'destructive',
      });
    },
  });

  const unassignPermissionMutation = useMutation({
    mutationFn: async ({ roleId, permissionKey }: { roleId: string; permissionKey: string }) => {
      const response = await apiRequest('DELETE', `/api/admin/roles/${roleId}/permissions/${permissionKey}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/role-permissions'] });
      toast({
        title: 'Success',
        description: 'Permission removed from role successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to remove permission',
        variant: 'destructive',
      });
    },
  });

  const availablePermissions = getAvailablePermissions(permissions, rolePermissions, selectedRoleId);
  const availablePermissionKeys = new Set(availablePermissions.map(({ key }) => key));
  const selectedAvailablePermissionKeys = selectedPermissionKeys.filter((key) => availablePermissionKeys.has(key));
  const allAvailableSelected =
    availablePermissions.length > 0 && selectedAvailablePermissionKeys.length === availablePermissions.length;
  const someAvailableSelected =
    selectedAvailablePermissionKeys.length > 0 && !allAvailableSelected;

  const handleAssignPermissions = () => {
    if (!selectedRoleId || selectedAvailablePermissionKeys.length === 0) return;
    assignPermissionsMutation.mutate({
      roleId: selectedRoleId,
      permissionKeys: selectedAvailablePermissionKeys,
    });
  };

  const handleUnassignPermission = (roleId: string, permissionKey: string) => {
    unassignPermissionMutation.mutate({ roleId, permissionKey });
  };

  if (permissionsLoading || rolesLoading || assignmentsLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading permissions...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Permission Assignment Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Assign Permissions to Roles
          </CardTitle>
          <CardDescription>
            Permissions are defined in code and cannot be created through the UI. Assign existing permissions to roles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="select-permission-role">Select Role</Label>
              <Select value={selectedRoleId} onValueChange={(value) => {
                setSelectedRoleId(value);
                setSelectedPermissionKeys([]);
              }}>
                <SelectTrigger id="select-permission-role" aria-label="Select Role" data-testid="select-permission-role">
                  <SelectValue placeholder="Choose a role..." />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role: Role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3" aria-label="Permissions to assign">
            {!selectedRoleId ? (
              <p className="text-sm text-muted-foreground">Select a role first to choose permissions.</p>
            ) : availablePermissions.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-all-permissions-assigned">
                All permissions are already assigned to this role.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b pb-2">
                  <Checkbox
                    id="select-all-permissions"
                    aria-label="Select all available permissions"
                    checked={allAvailableSelected ? true : someAvailableSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => {
                      setSelectedPermissionKeys((current) =>
                        getNextAllPermissionSelection(current, availablePermissions, checked === true),
                      );
                    }}
                    disabled={assignPermissionsMutation.isPending}
                    data-testid="checkbox-select-all-permissions"
                  />
                  <Label htmlFor="select-all-permissions" className="cursor-pointer">
                    Select all available permissions ({availablePermissions.length})
                  </Label>
                </div>
                <ul className="max-h-72 space-y-2 overflow-y-auto" aria-label="Available permissions">
                  {availablePermissions.map((permission) => {
                    const checkboxId = `permission-${permission.key}`;
                    return (
                      <li key={permission.key}>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={checkboxId}
                            aria-label={`Select ${permission.key}`}
                            checked={selectedAvailablePermissionKeys.includes(permission.key)}
                            onCheckedChange={(checked) => {
                              setSelectedPermissionKeys((current) =>
                                getNextPermissionSelection(current, permission.key, checked === true),
                              );
                            }}
                            disabled={assignPermissionsMutation.isPending}
                            data-testid={`checkbox-permission-${permission.key}`}
                          />
                          <Label htmlFor={checkboxId} className="cursor-pointer leading-5">
                            <span className="font-medium">{permission.key}</span>
                            <span className="text-muted-foreground"> — {permission.description}</span>
                          </Label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          <Button 
            onClick={handleAssignPermissions}
            disabled={
              assignPermissionsMutation.isPending ||
              !selectedRoleId ||
              selectedAvailablePermissionKeys.length === 0
            }
            className="w-full"
            data-testid="button-assign-permission"
          >
            {assignPermissionsMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Assigning permissions...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                {selectedAvailablePermissionKeys.length > 0
                  ? `Assign ${selectedAvailablePermissionKeys.length} Permission${selectedAvailablePermissionKeys.length === 1 ? '' : 's'}`
                  : 'Select permissions to assign'}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Available Permissions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Available Permissions
          </CardTitle>
          <CardDescription>
            System permissions defined in the codebase. These cannot be modified through the UI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Permission Key</TableHead>
                  <TableHead>Component</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Assigned Roles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...permissions].sort((a, b) => a.key.localeCompare(b.key)).map((permission: Permission) => {
                  const assignedRoles = getAssignedRoles(permission.key, rolePermissions);
                  return (
                    <TableRow key={permission.key} data-testid={`row-permission-${permission.key}`}>
                      <TableCell className="font-medium" data-testid={`text-permission-key-${permission.key}`}>
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-muted-foreground" />
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">
                            {permission.key}
                          </code>
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-component-${permission.key}`}>
                        {permission.module ? (
                          <Badge variant="outline">
                            {permission.module}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">core</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-permission-description-${permission.key}`}>
                        {permission.description || 'No description provided'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {assignedRoles.length > 0 ? (
                            assignedRoles.map((role) => (
                              <div key={role.id} className="flex items-center gap-1">
                                <Badge 
                                  variant="secondary"
                                  className="text-xs"
                                  data-testid={`badge-role-${permission.key}-${role.id}`}
                                >
                                  {role.name}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleUnassignPermission(role.id, permission.key)}
                                  disabled={unassignPermissionMutation.isPending}
                                  className="h-4 w-4 p-0 hover:bg-destructive/20"
                                  data-testid={`button-unassign-${permission.key}-${role.id}`}
                                  title={`Remove from ${role.name}`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">Not assigned</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}