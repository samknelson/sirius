import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, KeyRound } from 'lucide-react';
import { usePageTitle } from '@/contexts/PageTitleContext';

export default function AccountPasswordPage() {
  usePageTitle('Change Password');
  const { toast } = useToast();

  // This page only applies when local email+password login is enabled.
  const { data: providersData, isLoading: providersLoading } = useQuery<{
    providers: { type: string }[];
  }>({
    queryKey: ['/api/auth/providers'],
  });
  const localEnabled = !!providersData?.providers?.some((p) => p.type === 'local');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/auth/local/change-password', {
        currentPassword,
        newPassword,
      });
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Password changed', description: 'Your password was updated.' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to change password',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = () => {
    if (newPassword.length < 8) {
      toast({
        title: 'Password too short',
        description: 'Password must be at least 8 characters.',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'Please re-enter the new password.',
        variant: 'destructive',
      });
      return;
    }
    changePasswordMutation.mutate();
  };

  if (providersLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!localEnabled) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Change Password
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground" data-testid="text-local-unavailable">
              Password sign-in is not enabled on this site, so there is no password to change
              here. You sign in through an external identity provider.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Change the password you use to sign in with your email address.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              data-testid="input-current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-new-password">Confirm new password</Label>
            <Input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              data-testid="input-confirm-new-password"
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={
              changePasswordMutation.isPending ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
            }
            data-testid="button-change-password"
          >
            {changePasswordMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4 mr-2" />
            )}
            Change Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
