import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, LogIn, LogOut, UserPlus } from 'lucide-react';
import { SignIn, SignedIn, SignedOut, useClerk } from '@clerk/clerk-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { queryClient } from '@/lib/queryClient';

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface ProvidersResponse {
  providers: { type: string; isDefault: boolean }[];
  defaultProvider?: string;
}

const localLoginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LocalLoginFormData = z.infer<typeof localLoginSchema>;

function LocalLoginForm() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LocalLoginFormData>({
    resolver: zodResolver(localLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: LocalLoginFormData) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/auth/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorMessage(body?.message || 'Invalid email or password');
        setIsSubmitting(false);
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      // AuthContext picks up the new session and the page redirects.
    } catch {
      setErrorMessage('Login failed. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  data-testid="input-local-email"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  data-testid="input-local-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {errorMessage && (
          <p
            className="text-sm text-destructive"
            data-testid="text-local-login-error"
          >
            {errorMessage}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={isSubmitting}
          data-testid="button-local-login"
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <LogIn className="mr-2 h-5 w-5" />
          )}
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>
    </Form>
  );
}

function ClerkNotProvisionedMessage() {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();

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

      <Button
        variant="outline"
        className="w-full"
        onClick={() => signOut({ redirectUrl: "/login" })}
        data-testid="button-clerk-signout"
      >
        <LogOut className="mr-2 h-4 w-4" />
        Sign Out
      </Button>
    </div>
  );
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login, isAuthenticated, isLoading } = useAuth();

  const { data: providersData } = useQuery<ProvidersResponse>({
    queryKey: ['/api/auth/providers'],
    staleTime: 1000 * 60 * 5,
  });

  const localEnabled = !!providersData?.providers?.some((p) => p.type === 'local');

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
          {localEnabled && <LocalLoginForm />}

          {localEnabled && CLERK_ENABLED && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>
          )}

          {CLERK_ENABLED ? (
            <>
              <SignedOut>
                <SignIn
                  routing="hash"
                  appearance={{
                    elements: {
                      rootBox: "w-full",
                      card: "shadow-none w-full",
                    }
                  }}
                />

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
            !localEnabled && (
              <Button
                onClick={login}
                className="w-full"
                size="lg"
                data-testid="button-login"
              >
                <LogIn className="mr-2 h-5 w-5" />
                Sign in with Replit
              </Button>
            )
          )}

          <div className="mt-4 p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground text-center">
              Staff and employer accounts must be pre-authorized by an administrator.
              {CLERK_ENABLED && ' Workers can register using the link above.'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
