import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, Shield, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Role } from '@/lib/entity-types';

export default function RolesManagement() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleDescription, setEditRoleDescription] = useState('');
  const { toast } = useToast();

  const { data: roles = [], isLoading } = useQuery<Role[]>({
    queryKey: ['/api/admin/roles'],
  });

  const createRoleMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const maxSequence = roles.reduce((max, role) => Math.max(max, role.sequence), -1);
      return await apiRequest('POST', '/api/admin/roles', { 
        name, 
        description,
        sequence: maxSequence + 1
      });
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

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, name, description }: { id: string; name: string; description: string }) => {
      return await apiRequest('PUT', `/api/admin/roles/${id}`, { name, description });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
      setEditingRole(null);
      setEditRoleName('');
      setEditRoleDescription('');
      toast({
        title: 'Success',
        description: 'Role updated successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to update role',
        variant: 'destructive',
      });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/admin/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
      toast({
        title: 'Success',
        description: 'Role deleted successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to delete role',
        variant: 'destructive',
      });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: { id: string; sequence: number }) => {
      return apiRequest('PUT', `/api/admin/roles/${data.id}`, {
        sequence: data.sequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
    },
  });

  const moveUp = async (role: Role) => {
    const currentIndex = roles.findIndex(r => r.id === role.id);
    if (currentIndex > 0) {
      const prevRole = roles[currentIndex - 1];
      const currentSeq = role.sequence;
      const prevSeq = prevRole.sequence;
      
      try {
        await apiRequest('PUT', `/api/admin/roles/${role.id}`, { sequence: prevSeq });
        await apiRequest('PUT', `/api/admin/roles/${prevRole.id}`, { sequence: currentSeq });
        queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
      } catch (error) {
        toast({
          title: 'Error',
          description: 'Failed to reorder roles',
          variant: 'destructive',
        });
      }
    }
  };

  const moveDown = async (role: Role) => {
    const currentIndex = roles.findIndex(r => r.id === role.id);
    if (currentIndex < roles.length - 1) {
      const nextRole = roles[currentIndex + 1];
      const currentSeq = role.sequence;
      const nextSeq = nextRole.sequence;
      
      try {
        await apiRequest('PUT', `/api/admin/roles/${role.id}`, { sequence: nextSeq });
        await apiRequest('PUT', `/api/admin/roles/${nextRole.id}`, { sequence: currentSeq });
        queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
      } catch (error) {
        toast({
          title: 'Error',
          description: 'Failed to reorder roles',
          variant: 'destructive',
        });
      }
    }
  };

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

  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    setEditRoleName(role.name);
    setEditRoleDescription(role.description ?? '');
  };

  const handleUpdateRole = () => {
    if (!editingRole || !editRoleName) {
      toast({
        title: 'Error',
        description: 'Please enter a role name',
        variant: 'destructive',
      });
      return;
    }
    updateRoleMutation.mutate({ 
      id: editingRole.id, 
      name: editRoleName, 
      description: editRoleDescription 
    });
  };

  const handleDeleteRole = (roleId: string) => {
    deleteRoleMutation.mutate(roleId);
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
              <TableHead>Order</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role: Role, index) => (
              <TableRow key={role.id} data-testid={`row-role-${role.id}`}>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveUp(role)}
                      disabled={index === 0}
                      data-testid={`button-move-up-${role.id}`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveDown(role)}
                      disabled={index === roles.length - 1}
                      data-testid={`button-move-down-${role.id}`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="font-medium" data-testid={`text-role-name-${role.id}`}>
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    {role.name}
                  </div>
                </TableCell>
                <TableCell data-testid={`text-role-description-${role.id}`}>
                  {role.description || 'No description provided'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditRole(role)}
                      data-testid={`button-edit-role-${role.id}`}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Rename
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`button-delete-role-${role.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Role</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete the role "{role.name}"? This action cannot be undone and will remove all permission assignments for this role.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid={`button-cancel-delete-${role.id}`}>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteRole(role.id)}
                            data-testid={`button-confirm-delete-${role.id}`}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Edit Role Dialog */}
      <Dialog open={editingRole !== null} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription>
              Update the role name and description.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editRoleName">Role Name</Label>
              <Input
                id="editRoleName"
                value={editRoleName}
                onChange={(e) => setEditRoleName(e.target.value)}
                placeholder="Enter role name"
                data-testid="input-edit-role-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editRoleDescription">Description</Label>
              <Textarea
                id="editRoleDescription"
                value={editRoleDescription}
                onChange={(e) => setEditRoleDescription(e.target.value)}
                placeholder="Describe what this role can do..."
                rows={3}
                data-testid="input-edit-role-description"
              />
            </div>
            <Button 
              onClick={handleUpdateRole}
              disabled={updateRoleMutation.isPending}
              data-testid="button-submit-edit-role"
            >
              {updateRoleMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Role'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}