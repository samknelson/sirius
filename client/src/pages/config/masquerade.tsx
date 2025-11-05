import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { UserCog, Loader2, AlertTriangle, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountStatus: string;
  isActive: boolean;
}

export default function MasqueradePage() {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { toast } = useToast();
  const { masquerade } = useAuth();

  // Debounced search effect
  useEffect(() => {
    const searchUsers = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(`/api/admin/users/search?q=${encodeURIComponent(searchQuery)}`);
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data.filter((u: User) => u.isActive));
        } else {
          setSearchResults([]);
        }
      } catch (error) {
        console.error('Error searching users:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    const timeoutId = setTimeout(searchUsers, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const startMasqueradeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest('POST', '/api/auth/masquerade/start', { userId });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({
        title: 'Masquerade Started',
        description: 'You are now viewing the application as the selected user.',
      });
      // Redirect to home page to see the masqueraded view
      window.location.href = '/';
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start masquerade',
        variant: 'destructive',
      });
    },
  });

  const handleStartMasquerade = () => {
    if (!selectedUser) {
      toast({
        title: 'Error',
        description: 'Please select a user to masquerade as',
        variant: 'destructive',
      });
      return;
    }
    startMasqueradeMutation.mutate(selectedUser.id);
  };

  const getDisplayName = (user: User) => {
    const nameParts = [user.firstName, user.lastName].filter(Boolean);
    const name = nameParts.length > 0 ? nameParts.join(' ') : 'No name';
    return `${user.email || 'No email'} (${name})`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Masquerade</h2>
        <p className="text-muted-foreground mt-1">
          Temporarily view the application as another user for support and troubleshooting
        </p>
      </div>

      {masquerade.isMasquerading ? (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-800">
              <AlertTriangle className="h-5 w-5" />
              Already Masquerading
            </CardTitle>
            <CardDescription className="text-orange-700">
              You are currently masquerading as another user. Stop the current masquerade session before starting a new one.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Start Masquerade Session
            </CardTitle>
            <CardDescription>
              Select a user to temporarily access the application with their permissions and view. This action will be logged for security purposes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-search">Search User by Email</Label>
              <div className="relative">
                <Input
                  id="user-search"
                  data-testid="input-user-search"
                  type="text"
                  placeholder="Type to search by email address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full"
                />
                {selectedUser && (
                  <div className="mt-2 p-3 bg-accent rounded-md flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium">{getDisplayName(selectedUser)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedUser(null);
                        setSearchQuery('');
                      }}
                      data-testid="button-clear-selection"
                    >
                      Clear
                    </Button>
                  </div>
                )}
                {searchQuery.length >= 2 && !selectedUser && (
                  <Command className="mt-2 border rounded-md">
                    <CommandList>
                      {isSearching ? (
                        <div className="py-6 text-center text-sm">
                          <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                        </div>
                      ) : searchResults.length === 0 ? (
                        <CommandEmpty>No users found matching "{searchQuery}"</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {searchResults.map((user) => (
                            <CommandItem
                              key={user.id}
                              value={user.id}
                              onSelect={() => {
                                setSelectedUser(user);
                                setSearchQuery('');
                              }}
                              data-testid={`user-result-${user.id}`}
                              className="cursor-pointer"
                            >
                              <div className="flex flex-col">
                                <span className="font-medium">{user.email}</span>
                                {(user.firstName || user.lastName) && (
                                  <span className="text-sm text-muted-foreground">
                                    {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Search by email address to find active users
              </p>
            </div>

            <div className="bg-muted p-4 rounded-md space-y-2">
              <h4 className="font-semibold text-sm">Important Notes:</h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>You will see the application with the selected user's permissions</li>
                <li>All actions you take will be recorded under your original account</li>
                <li>A masquerade indicator will be shown at the top of the page</li>
                <li>Click "Stop Masquerade" in the header to return to your account</li>
              </ul>
            </div>

            <Button 
              onClick={handleStartMasquerade}
              disabled={!selectedUser || startMasqueradeMutation.isPending}
              className="w-full"
              data-testid="button-start-masquerade"
            >
              {startMasqueradeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting Masquerade...
                </>
              ) : (
                <>
                  <UserCog className="h-4 w-4 mr-2" />
                  Start Masquerade
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
