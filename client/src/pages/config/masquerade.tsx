import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { UserCog, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountStatus: string;
  isActive: boolean;
}

export default function MasqueradePage() {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const { toast } = useToast();
  const { masquerade } = useAuth();

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
  });

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
    if (!selectedUserId) {
      toast({
        title: 'Error',
        description: 'Please select a user to masquerade as',
        variant: 'destructive',
      });
      return;
    }
    startMasqueradeMutation.mutate(selectedUserId);
  };

  const getDisplayName = (user: User) => {
    const nameParts = [user.firstName, user.lastName].filter(Boolean);
    const name = nameParts.length > 0 ? nameParts.join(' ') : 'No name';
    return `${user.email || 'No email'} (${name})`;
  };

  // Filter to show only active users with linked accounts
  const availableUsers = users.filter(u => u.isActive && u.accountStatus === 'linked');

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
              <Label htmlFor="user-select">Select User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id="user-select" data-testid="select-masquerade-user">
                  <SelectValue placeholder="Choose a user to masquerade as..." />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No active users available
                    </div>
                  ) : (
                    availableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {getDisplayName(user)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Only active users with linked Replit accounts are shown
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
              disabled={!selectedUserId || startMasqueradeMutation.isPending}
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
