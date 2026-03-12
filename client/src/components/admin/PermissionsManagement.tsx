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
import { useState, useMemo } from 'react';
import { Role } from '@/lib/entity-types';

interface Permission {
  key: string;
  description: string;
  module?: string;
}

interface RolePermission {
  roleId: string;
  permissionKey: string;
  assignedAt: string;
  role: Role;
}

export default function PermissionsManagement() {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState<Set<string>>(new Set());
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

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ roleId, permissionKeys }: { roleId: string; permissionKeys: string[] }) => {
      return await apiRequest('POST', `/api/admin/roles/${roleId}/permissions/bulk`, { permissionKeys });
    },
    onSuccess: (data: { message: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/role-permissions'] });
      setSelectedPermissionKeys(new Set());
      toast({
        title: 'Success',
        description: data.message || 'Permissions assigned successfully',
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

  // Get permissions already assigned to the selected role
  const assignedPermissionKeys = useMemo(() => {
    if (!selectedRoleId) return new Set<string>();
    return new Set(
      rolePermissions
        .filter(rp => rp.roleId === selectedRoleId)
        .map(rp => rp.permissionKey)
    );
  }, [selectedRoleId, rolePermissions]);

  // Get available (unassigned) permissions for the selected role
  const availablePermissions = useMemo(() => {
    return [...permissions]
      .filter(p => !assignedPermissionKeys.has(p.key))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [permissions, assignedPermissionKeys]);

  const handleRoleChange = (value: string) => {
    setSelectedRoleId(value);
    setSelectedPermissionKeys(new Set());
  };

  const handlePermissionToggle = (permissionKey: string, checked: boolean) => {
    const newSelected = new Set(selectedPermissionKeys);
    if (checked) {
      newSelected.add(permissionKey);
    } else {
      newSelected.delete(permissionKey);
    }
    setSelectedPermissionKeys(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedPermissionKeys.size === availablePermissions.length) {
      setSelectedPermissionKeys(new Set());
    } else {
      setSelectedPermissionKeys(new Set(availablePermissions.map(p => p.key)));
    }
  };

  const handleBulkAssign = () => {
    if (!selectedRoleId || selectedPermissionKeys.size === 0) {
      toast({
        title: 'Error',
        description: 'Please select a role and at least one permission',
        variant: 'destructive',
      });
      return;
    }
    bulkAssignMutation.mutate({ 
      roleId: selectedRoleId, 
      permissionKeys: Array.from(selectedPermissionKeys) 
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

  const selectedRole = roles.find(r => r.id === selectedRoleId);
  const allSelected = availablePermissions.length > 0 && selectedPermissionKeys.size === availablePermissions.length;

  return (
    <div className="space-y-6">
      {/* Bulk Permission Assignment Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Assign Permissions to Roles
          </CardTitle>
          <CardDescription>
            Select a role, then check the permissions you want to assign and click "Assign Selected Permissions".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2 min-w-[200px]">
              <Label>Select Role</Label>
              <Select value={selectedRoleId} onValueChange={handleRoleChange}>
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

            {selectedRoleId && (
              <Button 
                onClick={handleBulkAssign}
                disabled={bulkAssignMutation.isPending || selectedPermissionKeys.size === 0}
                data-testid="button-bulk-assign-permissions"
              >
                {bulkAssignMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Assign Selected ({selectedPermissionKeys.size})
                  </>
                )}
              </Button>
            )}
          </div>

          {selectedRoleId && (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={handleSelectAll}
                        disabled={availablePermissions.length === 0}
                        data-testid="checkbox-select-all-permissions"
                      />
                    </TableHead>
                    <TableHead>Permission Key</TableHead>
                    <TableHead>Component</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availablePermissions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        All permissions are already assigned to {selectedRole?.name}
                      </TableCell>
                    </TableRow>
                  ) : (
                    availablePermissions.map((permission: Permission) => (
                      <TableRow 
                        key={permission.key} 
                        data-testid={`row-available-permission-${permission.key}`}
                        className="cursor-pointer"
                        onClick={() => handlePermissionToggle(permission.key, !selectedPermissionKeys.has(permission.key))}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedPermissionKeys.has(permission.key)}
                            onCheckedChange={(checked) => handlePermissionToggle(permission.key, !!checked)}
                            data-testid={`checkbox-permission-${permission.key}`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Key className="h-4 w-4 text-muted-foreground" />
                            <code className="text-xs bg-muted px-1 py-0.5 rounded">
                              {permission.key}
                            </code>
                          </div>
                        </TableCell>
                        <TableCell>
                          {permission.module ? (
                            <Badge variant="outline">
                              {permission.module}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">core</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {permission.description || 'No description provided'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Permissions Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            All Permissions
          </CardTitle>
          <CardDescription>
            Overview of all system permissions and their role assignments.
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
