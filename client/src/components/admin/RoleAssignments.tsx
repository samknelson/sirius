import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, UserCheck, X, Users, Shield } from 'lucide-react';

interface User {
  id: string;
  username: string;
  isActive: boolean;
}

interface Role {
  id: string;
  name: string;
  description: string;
}

interface UserWithRoles extends User {
  roles?: Role[];
}

interface UserRoleAssignment {
  userId: string;
  roles: Role[];
}

export default function RoleAssignments() {
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [userRoles, setUserRoles] = useState<Record<string, Role[]>>({});
  const { toast } = useToast();

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
  });

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ['/api/admin/roles'],
  });

  // Fetch user roles when users data is available
  const fetchUserRoles = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/roles`, {
        credentials: 'include',
      });
      if (response.ok) {
        const roles: Role[] = await response.json();
        setUserRoles(prev => ({ ...prev, [userId]: roles }));
      }
    } catch (error) {
      console.error('Failed to fetch user roles:', error);
    }
  };

  // Fetch all user roles when users change
  React.useEffect(() => {
    if (users.length > 0) {
      users.forEach((user: User) => {
        fetchUserRoles(user.id);
      });
    }
  }, [users]);

  const assignRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const response = await apiRequest('POST', `/api/admin/users/${userId}/roles`, { roleId });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      // Refresh user roles for the affected user
      if (selectedUserId) {
        fetchUserRoles(selectedUserId);
      }
      setSelectedUserId('');
      setSelectedRoleId('');
      setIsAssignOpen(false);
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
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const response = await apiRequest('DELETE', `/api/admin/users/${userId}/roles/${roleId}`);
      return response;
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      // Refresh user roles for the affected user
      fetchUserRoles(userId);
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

  const handleAssignRole = () => {
    if (!selectedUserId || !selectedRoleId) {
      toast({
        title: 'Error',
        description: 'Please select both a user and a role',
        variant: 'destructive',
      });
      return;
    }
    assignRoleMutation.mutate({ userId: selectedUserId, roleId: selectedRoleId });
  };

  const handleUnassignRole = (userId: string, roleId: string) => {
    unassignRoleMutation.mutate({ userId, roleId });
  };

  const getUserRoles = (userId: string): Role[] => {
    return userRoles[userId] || [];
  };

  if (usersLoading || rolesLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading assignments...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Assign Role Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5" />
              Assign Role to User
            </CardTitle>
            <CardDescription>
              Grant roles to users to control their system permissions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger data-testid="select-user">
                  <SelectValue placeholder="Choose a user..." />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user: User) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.username} {!user.isActive && '(Inactive)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Select Role</Label>
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger data-testid="select-role">
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

            <Button 
              onClick={handleAssignRole}
              disabled={assignRoleMutation.isPending || !selectedUserId || !selectedRoleId}
              className="w-full"
              data-testid="button-assign-role"
            >
              {assignRoleMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Assign Role
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Current Assignments Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Assignment Summary
            </CardTitle>
            <CardDescription>
              Overview of current role assignments in the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Users:</span>
                <Badge variant="outline" data-testid="badge-total-users">
                  {users.length}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Roles:</span>
                <Badge variant="outline" data-testid="badge-total-roles">
                  {roles.length}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Active Users:</span>
                <Badge variant="outline" data-testid="badge-active-users">
                  {users.filter((u: User) => u.isActive).length}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Current Assignments Table */}
      <Card>
        <CardHeader>
          <CardTitle>Current Role Assignments</CardTitle>
          <CardDescription>
            View and manage all user role assignments
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user: User) => {
                  const userRoles = getUserRoles(user.id);
                  return (
                    <TableRow key={user.id} data-testid={`row-assignment-${user.id}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          {user.username}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={user.isActive ? 'default' : 'secondary'}
                          data-testid={`badge-user-status-${user.id}`}
                        >
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {userRoles.length > 0 ? (
                            userRoles.map((role) => (
                              <div key={role.id} className="flex items-center gap-1">
                                <Badge 
                                  variant="outline"
                                  className="text-xs"
                                  data-testid={`badge-user-role-${user.id}-${role.id}`}
                                >
                                  {role.name}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleUnassignRole(user.id, role.id)}
                                  disabled={unassignRoleMutation.isPending}
                                  className="h-4 w-4 p-0 hover:bg-destructive/20"
                                  data-testid={`button-unassign-${user.id}-${role.id}`}
                                  title={`Remove ${role.name} role`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">No roles assigned</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Individual role management moved to role badges */}
                        <span className="text-xs text-muted-foreground">
                          {userRoles.length} role{userRoles.length !== 1 ? 's' : ''}
                        </span>
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