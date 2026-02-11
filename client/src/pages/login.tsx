import { useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { SignInButton, SignedIn, SignedOut, useClerk } from '@clerk/clerk-react';

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function ClerkNotProvisionedMessage() {
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();

  return (
    <div className="space-y-4">
      <div className="p-4 bg-muted border rounded-lg">
        <p className="text-sm text-foreground text-center">
          You are signed in, but we need to verify your identity before you can access the system.
        </p>
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={() => setLocation('/verify-worker')}
        data-testid="button-verify-worker"
      >
        <ShieldCheck className="mr-2 h-5 w-5" />
        I'm a Worker — Verify My Identity
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <p className="text-sm text-muted-foreground text-center">
          If you are staff or an employer contact, your administrator needs to set up your account first.
          Once they do, sign in again and you'll be connected automatically.
        </p>
      </div>

      <Button
        onClick={() => signOut({ redirectUrl: '/' })}
        variant="outline"
        className="w-full"
        data-testid="button-clerk-signout"
      >
        Sign out and try a different account
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
              Your account must be pre-authorized by an administrator. 
              If you don't have access, please contact your system administrator.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
