import { useState } from 'react';
import { useRoute } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, UserCheck, UserX, Key } from 'lucide-react';
import { Link } from 'wouter';

interface UserDetails {
  id: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
}

export default function UserAccountPage() {
  const [, params] = useRoute('/admin/users/:id');
  const userId = params?.id;
  const [newPassword, setNewPassword] = useState('');
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<UserDetails>({
    queryKey: ['/api/admin/users', userId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/users/${userId}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch user details');
      }
      return await response.json();
    },
    enabled: !!userId,
  });

  const updatePasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const response = await apiRequest('PUT', `/api/admin/users/${userId}/password`, { password });
      return await response.json();
    },
    onSuccess: () => {
      setNewPassword('');
      toast({
        title: 'Success',
        description: 'Password updated successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to update password',
        variant: 'destructive',
      });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const response = await apiRequest('PUT', `/api/admin/users/${userId}/status`, { isActive });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users', userId] });
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

  const handlePasswordUpdate = () => {
    if (!newPassword || newPassword.trim().length === 0) {
      toast({
        title: 'Error',
        description: 'Please enter a new password',
        variant: 'destructive',
      });
      return;
    }
    updatePasswordMutation.mutate(newPassword);
  };

  const handleToggleStatus = () => {
    if (user) {
      toggleStatusMutation.mutate(!user.isActive);
    }
  };

  if (!userId) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-red-600">Invalid User</h2>
          <p className="text-muted-foreground mt-2">No user ID provided</p>
          <Link to="/admin/users">
            <Button className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Users
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading user details...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-red-600">User Not Found</h2>
          <p className="text-muted-foreground mt-2">The requested user could not be found</p>
          <Link to="/admin/users">
            <Button className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Users
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/admin/users">
          <Button variant="outline" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Users
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">User Account: {user.username}</h1>
      </div>

      {/* User Information Card */}
      <Card>
        <CardHeader>
          <CardTitle>User Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Username</Label>
              <p className="font-medium" data-testid="text-username">{user.username}</p>
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
              <p className="font-medium">Current Status: 
                <Badge 
                  className="ml-2"
                  variant={user.isActive ? 'default' : 'secondary'}
                >
                  {user.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </p>
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

      {/* Password Change Card */}
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              data-testid="input-new-password"
            />
          </div>
          <Button
            onClick={handlePasswordUpdate}
            disabled={updatePasswordMutation.isPending}
            data-testid="button-update-password"
          >
            {updatePasswordMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Updating Password...
              </>
            ) : (
              <>
                <Key className="h-4 w-4 mr-2" />
                Update Password
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}