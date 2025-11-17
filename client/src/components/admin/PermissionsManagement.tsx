import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Key, Shield, Plus, X } from 'lucide-react';
import { useState } from 'react';

interface Permission {
  key: string;
  description: string;
  category: string;
}

interface Role {
  id: string;
  name: string;
  description: string;
}

interface RolePermission {
  roleId: string;
  permissionKey: string;
  assignedAt: string;
  role: Role;
}

export default function PermissionsManagement() {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedPermissionKey, setSelectedPermissionKey] = useState('');
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

  const assignPermissionMutation = useMutation({
    mutationFn: async ({ roleId, permissionKey }: { roleId: string; permissionKey: string }) => {
      return await apiRequest('POST', `/api/admin/roles/${roleId}/permissions`, { permissionKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/role-permissions'] });
      setSelectedRoleId('');
      setSelectedPermissionKey('');
      toast({
        title: 'Success',
        description: 'Permission assigned to role successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to assign permission',
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

  const handleAssignPermission = () => {
    if (!selectedRoleId || !selectedPermissionKey) {
      toast({
        title: 'Error',
        description: 'Please select both a role and a permission',
        variant: 'destructive',
      });
      return;
    }
    assignPermissionMutation.mutate({ roleId: selectedRoleId, permissionKey: selectedPermissionKey });
  };

  const handleUnassignPermission = (roleId: string, permissionKey: string) => {
    unassignPermissionMutation.mutate({ roleId, permissionKey });
  };

  const getPermissionCategory = (key: string) => {
    const category = key.split('.')[0];
    switch (category) {
      case 'admin':
        return 'Admin';
      case 'workers':
        return 'Workers';
      default:
        return 'System';
    }
  };

  const getPermissionAction = (key: string) => {
    const parts = key.split('.');
    return parts[parts.length - 1];
  };

  const getPermissionsForRole = (roleId: string): string[] => {
    return rolePermissions
      .filter(rp => rp.roleId === roleId)
      .map(rp => rp.permissionKey);
  };

  const getAvailablePermissions = (): Permission[] => {
    const assignedKeys = rolePermissions.map(rp => rp.permissionKey);
    return permissions.filter(p => !assignedKeys.includes(p.key) || 
      (selectedRoleId && !getPermissionsForRole(selectedRoleId).includes(p.key)));
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
              <Label>Select Role</Label>
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger data-testid="select-permission-role">
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

            <div className="space-y-2">
              <Label>Select Permission</Label>
              <Select value={selectedPermissionKey} onValueChange={setSelectedPermissionKey}>
                <SelectTrigger data-testid="select-permission-key">
                  <SelectValue placeholder="Choose a permission..." />
                </SelectTrigger>
                <SelectContent>
                  {getAvailablePermissions().map((permission: Permission) => (
                    <SelectItem key={permission.key} value={permission.key}>
                      <div className="flex items-center gap-2">
                        <code className="text-xs">{permission.key}</code>
                        <span className="text-muted-foreground">- {permission.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button 
            onClick={handleAssignPermission}
            disabled={assignPermissionMutation.isPending || !selectedRoleId || !selectedPermissionKey}
            className="w-full"
            data-testid="button-assign-permission"
          >
            {assignPermissionMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Assigning...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Assign Permission
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
                  <TableHead>Category</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Assigned Roles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.map((permission: Permission) => {
                  const assignedRoles = rolePermissions
                    .filter(rp => rp.permissionKey === permission.key)
                    .map(rp => rp.role);
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
                      <TableCell>
                        <Badge variant="outline" data-testid={`badge-category-${permission.key}`}>
                          {getPermissionCategory(permission.key)}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-action-${permission.key}`}>
                        {getPermissionAction(permission.key)}
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