import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, Shield } from 'lucide-react';

interface Role {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export default function RolesManagement() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const { toast } = useToast();

  const { data: roles = [], isLoading } = useQuery<Role[]>({
    queryKey: ['/api/admin/roles'],
  });

  const createRoleMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const response = await apiRequest('POST', '/api/admin/roles', { name, description });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
      setNewRoleName('');
      setNewRoleDescription('');
      setIsCreateOpen(false);
      toast({
        title: 'Success',
        description: 'Role created successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to create role',
        variant: 'destructive',
      });
    },
  });

  const handleCreateRole = () => {
    if (!newRoleName) {
      toast({
        title: 'Error',
        description: 'Please enter a role name',
        variant: 'destructive',
      });
      return;
    }
    createRoleMutation.mutate({ name: newRoleName, description: newRoleDescription });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading roles...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">System Roles</h3>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-role">
              <Plus className="h-4 w-4 mr-2" />
              Create Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Role</DialogTitle>
              <DialogDescription>
                Define a new system role with its name and description.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="roleName">Role Name</Label>
                <Input
                  id="roleName"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="Enter role name (e.g., Manager)"
                  data-testid="input-new-role-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="roleDescription">Description</Label>
                <Textarea
                  id="roleDescription"
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  placeholder="Describe what this role can do..."
                  rows={3}
                  data-testid="input-new-role-description"
                />
              </div>
              <Button 
                onClick={handleCreateRole}
                disabled={createRoleMutation.isPending}
                data-testid="button-submit-role"
              >
                {createRoleMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Role'
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
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role: Role) => (
              <TableRow key={role.id} data-testid={`row-role-${role.id}`}>
                <TableCell className="font-medium" data-testid={`text-role-name-${role.id}`}>
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    {role.name}
                  </div>
                </TableCell>
                <TableCell data-testid={`text-role-description-${role.id}`}>
                  {role.description || 'No description provided'}
                </TableCell>
                <TableCell data-testid={`text-role-created-${role.id}`}>
                  {new Date(role.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}