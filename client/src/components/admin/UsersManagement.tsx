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
  replitUserId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  accountStatus: string;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
  roles: Role[];
}

type SortField = 'email' | 'createdAt' | 'lastLogin';
type SortDirection = 'asc' | 'desc';

export default function UsersManagement() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserFirstName, setNewUserFirstName] = useState('');
  const [newUserLastName, setNewUserLastName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [accountStatusFilter, setAccountStatusFilter] = useState<'all' | 'pending' | 'linked'>('all');
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
      
      // Filter by account status
      const matchesAccountStatus = accountStatusFilter === 'all' ||
        user.accountStatus === accountStatusFilter;
      
      // Filter by role
      const matchesRole = roleFilter === 'all' || 
        user.roles.some(role => role.id === roleFilter);
      
      return matchesSearch && matchesStatus && matchesAccountStatus && matchesRole;
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
  }, [users, searchQuery, statusFilter, accountStatusFilter, roleFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const createUserMutation = useMutation({
    mutationFn: async (userData: { email: string; firstName?: string; lastName?: string }) => {
      return await apiRequest('POST', '/api/admin/users', userData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setNewUserEmail('');
      setNewUserFirstName('');
      setNewUserLastName('');
      setIsCreateOpen(false);
      toast({
        title: 'Success',
        description: 'User provisioned successfully. They can now log in with their Replit account.',
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
    if (!newUserEmail) {
      toast({
        title: 'Error',
        description: 'Please enter an email address',
        variant: 'destructive',
      });
      return;
    }
    createUserMutation.mutate({ 
      email: newUserEmail,
      firstName: newUserFirstName || undefined,
      lastName: newUserLastName || undefined,
    });
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
              <DialogTitle>Provision New User</DialogTitle>
              <DialogDescription>
                Provision a user by email. They can log in with their Replit account once provisioned.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="user@example.com"
                  data-testid="input-new-user-email"
                />
                <p className="text-sm text-muted-foreground">
                  Must match their Replit account email
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name (Optional)</Label>
                <Input
                  id="firstName"
                  value={newUserFirstName}
                  onChange={(e) => setNewUserFirstName(e.target.value)}
                  placeholder="John"
                  data-testid="input-new-user-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name (Optional)</Label>
                <Input
                  id="lastName"
                  value={newUserLastName}
                  onChange={(e) => setNewUserLastName(e.target.value)}
                  placeholder="Doe"
                  data-testid="input-new-user-lastname"
                />
              </div>
              <Button 
                onClick={handleCreateUser}
                disabled={createUserMutation.isPending}
                data-testid="button-submit-user"
              >
                {createUserMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Provisioning...
                  </>
                ) : (
                  'Provision User'
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
        <Select value={accountStatusFilter} onValueChange={(value: 'all' | 'pending' | 'linked') => setAccountStatusFilter(value)}>
          <SelectTrigger className="w-44" data-testid="select-account-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Accounts</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="linked">Linked</SelectItem>
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
              <TableHead>Account Status</TableHead>
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
                  <div className="flex flex-col gap-1">
                    <Badge 
                      variant={user.accountStatus === 'linked' ? 'default' : 'outline'}
                      data-testid={`status-account-${user.id}`}
                      className="w-fit"
                    >
                      {user.accountStatus === 'linked' ? 'Linked' : 'Pending'}
                    </Badge>
                    {!user.isActive && (
                      <Badge 
                        variant="secondary"
                        data-testid={`status-active-${user.id}`}
                        className="w-fit"
                      >
                        Inactive
                      </Badge>
                    )}
                    {user.accountStatus === 'linked' && user.replitUserId && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {user.replitUserId}
                      </span>
                    )}
                  </div>
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
                  <Link to={`/users/${user.id}`}>
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