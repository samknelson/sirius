import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Search, ExternalLink } from 'lucide-react';
import { Link } from 'wouter';

interface Role {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
  roles: Role[];
}

type SortField = 'email' | 'createdAt' | 'lastLogin';
type SortDirection = 'asc' | 'desc';

export default function UsersManagement() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newReplitUserId, setNewReplitUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('email');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const { toast } = useToast();

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
  });

  const { data: allRoles = [] } = useQuery<Role[]>({
    queryKey: ['/api/admin/roles'],
  });

  // Filter and sort users
  const filteredAndSortedUsers = useMemo(() => {
    let filtered = users.filter(user => {
      // Filter by search query (email or name)
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = searchQuery === '' || 
        (user.email && user.email.toLowerCase().includes(searchLower)) ||
        (user.firstName && user.firstName.toLowerCase().includes(searchLower)) ||
        (user.lastName && user.lastName.toLowerCase().includes(searchLower)) ||
        user.id.toLowerCase().includes(searchLower);
      
      // Filter by status
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'active' && user.isActive) ||
        (statusFilter === 'inactive' && !user.isActive);
      
      // Filter by role
      const matchesRole = roleFilter === 'all' || 
        user.roles.some(role => role.id === roleFilter);
      
      return matchesSearch && matchesStatus && matchesRole;
    });

    // Sort users
    filtered.sort((a, b) => {
      let aValue: string | Date;
      let bValue: string | Date;
      
      switch (sortField) {
        case 'email':
          // Handle null emails - put them at end when desc, beginning when asc
          if (!a.email && !b.email) return 0;
          if (!a.email) return sortDirection === 'asc' ? 1 : -1;
          if (!b.email) return sortDirection === 'asc' ? -1 : 1;
          aValue = a.email;
          bValue = b.email;
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt);
          bValue = new Date(b.createdAt);
          break;
        case 'lastLogin':
          // Handle null/undefined lastLogin values - put them at end when desc, beginning when asc
          if (!a.lastLogin && !b.lastLogin) return 0;
          if (!a.lastLogin) return sortDirection === 'asc' ? 1 : -1;
          if (!b.lastLogin) return sortDirection === 'asc' ? -1 : 1;
          aValue = new Date(a.lastLogin);
          bValue = new Date(b.lastLogin);
          break;
        default:
          return 0;
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [users, searchQuery, statusFilter, roleFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const createUserMutation = useMutation({
    mutationFn: async ({ replitUserId }: { replitUserId: string }) => {
      const response = await apiRequest('POST', '/api/admin/users', { replitUserId });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setNewReplitUserId('');
      setIsCreateOpen(false);
      toast({
        title: 'Success',
        description: 'User created successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, '') : 'Failed to create user',
        variant: 'destructive',
      });
    },
  });


  const handleCreateUser = () => {
    if (!newReplitUserId) {
      toast({
        title: 'Error',
        description: 'Please enter a Replit user ID',
        variant: 'destructive',
      });
      return;
    }
    createUserMutation.mutate({ replitUserId: newReplitUserId });
  };


  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-4 w-4" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading users...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">System Users</h3>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-user">
              <Plus className="h-4 w-4 mr-2" />
              Create User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Create a new user account using their Replit user ID. The user will be able to log in with Replit Auth.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="replitUserId">Replit User ID</Label>
                <Input
                  id="replitUserId"
                  value={newReplitUserId}
                  onChange={(e) => setNewReplitUserId(e.target.value)}
                  placeholder="Enter Replit user ID (e.g., 45808420)"
                  data-testid="input-new-replit-user-id"
                />
                <p className="text-sm text-muted-foreground">
                  Find the user's ID in their Replit profile URL
                </p>
              </div>
              <Button 
                onClick={handleCreateUser}
                disabled={createUserMutation.isPending}
                data-testid="button-submit-user"
              >
                {createUserMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create User'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search and Filter Controls */}
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by email, name, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
            data-testid="input-search-user"
          />
        </div>
        <Select value={statusFilter} onValueChange={(value: 'all' | 'active' | 'inactive') => setStatusFilter(value)}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            <SelectItem value="active">Active Only</SelectItem>
            <SelectItem value="inactive">Inactive Only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-48" data-testid="select-role-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {allRoles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort('email')}
                data-testid="header-email"
              >
                <div className="flex items-center gap-2">
                  Email / Name
                  {getSortIcon('email')}
                </div>
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort('createdAt')}
                data-testid="header-created"
              >
                <div className="flex items-center gap-2">
                  Created At
                  {getSortIcon('createdAt')}
                </div>
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort('lastLogin')}
                data-testid="header-lastlogin"
              >
                <div className="flex items-center gap-2">
                  Last Login
                  {getSortIcon('lastLogin')}
                </div>
              </TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedUsers.map((user: User) => (
              <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                <TableCell data-testid={`text-user-info-${user.id}`}>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {user.email || 'No email'}
                    </span>
                    {(user.firstName || user.lastName) && (
                      <span className="text-sm text-muted-foreground">
                        {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">
                      ID: {user.id}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={user.isActive ? 'default' : 'secondary'}
                    data-testid={`status-user-${user.id}`}
                  >
                    {user.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell data-testid={`text-roles-${user.id}`}>
                  <div className="flex flex-wrap gap-1">
                    {user.roles && user.roles.length > 0 ? (
                      user.roles.map((role) => (
                        <Badge 
                          key={role.id}
                          variant="outline"
                          className="text-xs"
                          data-testid={`badge-role-${user.id}-${role.id}`}
                        >
                          {role.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No roles</span>
                    )}
                  </div>
                </TableCell>
                <TableCell data-testid={`text-created-${user.id}`}>
                  {new Date(user.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell data-testid={`text-lastlogin-${user.id}`}>
                  {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
                </TableCell>
                <TableCell className="text-right">
                  <Link to={`/admin/users/${user.id}`}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-view-account-${user.id}`}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Account
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}