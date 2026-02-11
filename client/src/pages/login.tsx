import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { SignInButton, SignedIn, SignedOut } from '@clerk/clerk-react';

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function ClerkNotProvisionedMessage() {
  const [, setLocation] = useLocation();

  return (
    <div className="space-y-4">
      <div className="p-4 bg-muted border rounded-lg">
        <p className="text-sm text-foreground text-center">
          You are signed in, but your account is not yet linked to the system.
          If you are staff or an employer contact, please ask your administrator to set up your account.
        </p>
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => setLocation("/login")}
        data-testid="button-clerk-retry"
      >
        Refresh
      </Button>
    </div>
  );
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const redirectTo = sessionStorage.getItem('redirectAfterLogin');
      if (redirectTo) {
        sessionStorage.removeItem('redirectAfterLogin');
        setLocation(redirectTo);
      } else {
        setLocation('/dashboard');
      }
    }
  }, [isAuthenticated, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Checking authentication...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="p-3 bg-primary/10 rounded-full">
              <LogIn className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Welcome to Sirius</CardTitle>
          <CardDescription>
            Sign in to access the worker management system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {CLERK_ENABLED ? (
            <>
              <SignedOut>
                <SignInButton mode="modal">
                  <Button
                    className="w-full"
                    size="lg"
                    data-testid="button-login-clerk"
                  >
                    <LogIn className="mr-2 h-5 w-5" />
                    Sign In
                  </Button>
                </SignInButton>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  size="lg"
                  onClick={() => setLocation("/register")}
                  data-testid="button-login-register"
                >
                  <UserPlus className="mr-2 h-5 w-5" />
                  Register as a Worker
                </Button>
              </SignedOut>
              <SignedIn>
                <ClerkNotProvisionedMessage />
              </SignedIn>
            </>
          ) : (
            <Button
              onClick={login}
              className="w-full"
              size="lg"
              data-testid="button-login"
            >
              <LogIn className="mr-2 h-5 w-5" />
              Sign in with Replit
            </Button>
          )}

          <div className="mt-4 p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground text-center">
              Staff and employer accounts must be pre-authorized by an administrator.
              Workers can register using the link above.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
