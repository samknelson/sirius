import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, Key } from 'lucide-react';

interface Permission {
  id: string;
  key: string;
  description: string;
  createdAt: string;
}

export default function PermissionsManagement() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPermissionKey, setNewPermissionKey] = useState('');
  const [newPermissionDescription, setNewPermissionDescription] = useState('');
  const { toast } = useToast();

  const { data: permissions = [], isLoading } = useQuery<Permission[]>({
    queryKey: ['/api/admin/permissions'],
  });

  const createPermissionMutation = useMutation({
    mutationFn: async ({ key, description }: { key: string; description: string }) => {
      const response = await apiRequest('POST', '/api/admin/permissions', { key, description });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/permissions'] });
      setNewPermissionKey('');
      setNewPermissionDescription('');
      setIsCreateOpen(false);
      toast({
        title: 'Success',
        description: 'Permission created successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to create permission',
        variant: 'destructive',
      });
    },
  });

  const handleCreatePermission = () => {
    if (!newPermissionKey) {
      toast({
        title: 'Error',
        description: 'Please enter a permission key',
        variant: 'destructive',
      });
      return;
    }
    createPermissionMutation.mutate({ key: newPermissionKey, description: newPermissionDescription });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading permissions...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">System Permissions</h3>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-permission">
              <Plus className="h-4 w-4 mr-2" />
              Create Permission
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Permission</DialogTitle>
              <DialogDescription>
                Define a new system permission with a unique key and description.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="permissionKey">Permission Key</Label>
                <Input
                  id="permissionKey"
                  value={newPermissionKey}
                  onChange={(e) => setNewPermissionKey(e.target.value)}
                  placeholder="e.g., reports.view, users.delete"
                  data-testid="input-new-permission-key"
                />
                <p className="text-xs text-muted-foreground">
                  Use format: category.action (e.g., workers.manage, admin.view)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="permissionDescription">Description</Label>
                <Textarea
                  id="permissionDescription"
                  value={newPermissionDescription}
                  onChange={(e) => setNewPermissionDescription(e.target.value)}
                  placeholder="Describe what this permission allows..."
                  rows={3}
                  data-testid="input-new-permission-description"
                />
              </div>
              <Button 
                onClick={handleCreatePermission}
                disabled={createPermissionMutation.isPending}
                data-testid="button-submit-permission"
              >
                {createPermissionMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Permission'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Permission Key</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissions.map((permission: Permission) => (
              <TableRow key={permission.id} data-testid={`row-permission-${permission.id}`}>
                <TableCell className="font-medium" data-testid={`text-permission-key-${permission.id}`}>
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                      {permission.key}
                    </code>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" data-testid={`badge-category-${permission.id}`}>
                    {getPermissionCategory(permission.key)}
                  </Badge>
                </TableCell>
                <TableCell data-testid={`text-action-${permission.id}`}>
                  {getPermissionAction(permission.key)}
                </TableCell>
                <TableCell data-testid={`text-permission-description-${permission.id}`}>
                  {permission.description || 'No description provided'}
                </TableCell>
                <TableCell data-testid={`text-permission-created-${permission.id}`}>
                  {new Date(permission.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}