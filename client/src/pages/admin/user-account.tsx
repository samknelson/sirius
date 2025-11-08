import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UserCheck, UserX, Shield } from 'lucide-react';
import { UserLayout, useUserLayout } from '@/components/layouts/UserLayout';

interface Role {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

function UserAccountContent() {
  const { user } = useUserLayout();
  const { toast } = useToast();

  const { data: allRoles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ['/api/admin/roles'],
  });

  const { data: userRoles = [], isLoading: userRolesLoading } = useQuery<Role[]>({
    queryKey: ['/api/admin/users', user.id, 'roles'],
    queryFn: async () => {
      const response = await fetch(`/api/admin/users/${user.id}/roles`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch user roles');
      }
      return await response.json();
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const response = await apiRequest('PUT', `/api/admin/users/${user.id}/status`, { isActive });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users', user.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: 'Success',
        description: 'User status updated successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to update user status',
        variant: 'destructive',
      });
    },
  });

  const assignRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const response = await apiRequest('POST', `/api/admin/users/${user.id}/roles`, { roleId });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users', user.id, 'roles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: 'Success',
        description: 'Role assigned successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to assign role',
        variant: 'destructive',
      });
    },
  });

  const unassignRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const response = await apiRequest('DELETE', `/api/admin/users/${user.id}/roles/${roleId}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users', user.id, 'roles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: 'Success',
        description: 'Role unassigned successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to unassign role',
        variant: 'destructive',
      });
    },
  });

  const handleToggleStatus = () => {
    if (user) {
      toggleStatusMutation.mutate(!user.isActive);
    }
  };

  const handleRoleToggle = (roleId: string, isChecked: boolean) => {
    if (isChecked) {
      assignRoleMutation.mutate(roleId);
    } else {
      unassignRoleMutation.mutate(roleId);
    }
  };

  const isRoleAssigned = (roleId: string) => {
    return userRoles.some(role => role.id === roleId);
  };

  if (rolesLoading || userRolesLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading user details...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* User Information Card */}
      <Card>
        <CardHeader>
          <CardTitle>User Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Replit User ID</Label>
              <p className="font-mono text-sm" data-testid="text-userid">{user.id}</p>
            </div>
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Status</Label>
              <div>
                <Badge 
                  variant={user.isActive ? 'default' : 'secondary'}
                  data-testid="status-user"
                >
                  {user.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Email</Label>
              <p className="font-medium" data-testid="text-email">{user.email || 'Not provided'}</p>
            </div>
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Name</Label>
              <p data-testid="text-name">
                {user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName || user.lastName || 'Not provided'}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Created At</Label>
              <p data-testid="text-created">{new Date(user.createdAt).toLocaleDateString()}</p>
            </div>
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Last Login</Label>
              <p data-testid="text-lastlogin">
                {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>Account Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Current Status:</span>
                <Badge variant={user.isActive ? 'default' : 'secondary'}>
                  {user.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {user.isActive ? 'This user can log in and access the system' : 'This user cannot log in to the system'}
              </p>
            </div>
            <Button
              variant={user.isActive ? 'destructive' : 'default'}
              onClick={handleToggleStatus}
              disabled={toggleStatusMutation.isPending}
              data-testid="button-toggle-status"
            >
              {toggleStatusMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : user.isActive ? (
                <UserX className="h-4 w-4 mr-2" />
              ) : (
                <UserCheck className="h-4 w-4 mr-2" />
              )}
              {user.isActive ? 'Deactivate User' : 'Activate User'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Role Assignment Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Role Assignments
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Assign roles to control this user's system permissions
          </div>
          
          {allRoles.length > 0 ? (
            <div className="grid gap-3">
              {allRoles.map((role) => {
                const isChecked = isRoleAssigned(role.id);
                const isChanging = (assignRoleMutation.isPending || unassignRoleMutation.isPending);
                
                return (
                  <div key={role.id} className="flex items-start space-x-3">
                    <Checkbox
                      id={`role-${role.id}`}
                      checked={isChecked}
                      onCheckedChange={(checked) => handleRoleToggle(role.id, checked as boolean)}
                      disabled={isChanging}
                      data-testid={`checkbox-role-${role.id}`}
                    />
                    <div className="grid gap-1.5 leading-none">
                      <Label
                        htmlFor={`role-${role.id}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {role.name}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {role.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">No roles available in the system</p>
            </div>
          )}
          
          {(assignRoleMutation.isPending || unassignRoleMutation.isPending) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating role assignments...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function UserAccountPage() {
  return (
    <UserLayout activeTab="details">
      <UserAccountContent />
    </UserLayout>
  );
}