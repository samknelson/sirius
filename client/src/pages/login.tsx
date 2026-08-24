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
import { sanitizeHtml } from '@shared/utils/html';
import { useSiteSettings, useVariableValue } from '@/lib/use-variable';

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

type ProviderInfo = { type: string; isDefault: boolean };
interface ProvidersResponse {
  providers: ProviderInfo[];
  defaultProvider?: string;
}

function useAuthProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [workerRegistrationEnabled, setWorkerRegistrationEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/providers', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { providers: [], workerRegistrationEnabled: false }))
      .then((data) => {
        if (!cancelled) {
          setProviders(data.providers || []);
          setWorkerRegistrationEnabled(!!data.workerRegistrationEnabled);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviders([]);
          setWorkerRegistrationEnabled(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { providers, workerRegistrationEnabled };
}

/**
 * Display labels for redirect-based auth providers. `local` renders its own
 * form and `clerk` its own widget; both are excluded from the button list.
 */
const PROVIDER_BUTTON_LABELS: Record<string, string> = {
  replit: 'Sign in with Replit',
  okta: 'Sign in with Okta',
  saml: 'Sign in with single sign-on (SSO)',
  oauth: 'Sign in with single sign-on (SSO)',
};

const NON_BUTTON_PROVIDERS = new Set(['local', 'clerk']);

function OrDivider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-card px-2 text-muted-foreground">or</span>
      </div>
    </div>
  );
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
  const { isAuthenticated, isLoading } = useAuth();
  const { workerRegistrationEnabled } = useAuthProviders();

  const { data: providersData, isError: providersError } = useQuery<ProvidersResponse>({
    queryKey: ['/api/auth/providers'],
    staleTime: 1000 * 60 * 5,
  });

  const localEnabled = !!providersData?.providers?.some((p) => p.type === 'local');
  const buttonProviders = (providersData?.providers ?? []).filter(
    (p) => !NON_BUTTON_PROVIDERS.has(p.type),
  );

  const { siteName } = useSiteSettings();
  const loginTitleQuery = useVariableValue('login_page_title');
  const loginIntroQuery = useVariableValue('login_page_intro');
  const loginTitle =
    typeof loginTitleQuery.data === 'string' && loginTitleQuery.data.trim()
      ? loginTitleQuery.data
      : `Welcome to ${siteName}`;
  const loginIntroHtml =
    typeof loginIntroQuery.data === 'string' && loginIntroQuery.data.trim()
      ? sanitizeHtml(loginIntroQuery.data, 'styled-text')
      : null;

  // Render the Clerk widget only when the server actually configures the
  // clerk provider (a leftover build-time publishable key must not hijack a
  // SAML/Replit deployment). While the provider list is loading or on error,
  // fall back to the client-side key so Clerk-only sites don't flicker.
  const clerkActive =
    CLERK_ENABLED &&
    (providersData
      ? providersData.providers.some((p) => p.type === 'clerk')
      : true);

  // Sign-in mechanisms actually rendered, in order, separated by "or".
  const sections: { key: string; node: JSX.Element }[] = [];
  if (localEnabled) {
    sections.push({ key: 'local', node: <LocalLoginForm /> });
  }
  if (clerkActive) {
    sections.push({
      key: 'clerk',
      node: (
        <>
          <SignedOut>
            <SignIn
              routing="hash"
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none w-full',
                },
              }}
            />
            {workerRegistrationEnabled && (
              <div className="mt-4 space-y-4">
                <OrDivider />
                <Button
                  variant="outline"
                  className="w-full"
                  size="lg"
                  onClick={() => setLocation('/register')}
                  data-testid="button-login-register"
                >
                  <UserPlus className="mr-2 h-5 w-5" />
                  Register as a Worker
                </Button>
              </div>
            )}
          </SignedOut>
          <SignedIn>
            <ClerkNotProvisionedMessage />
          </SignedIn>
        </>
      ),
    });
  }
  if (buttonProviders.length > 0) {
    sections.push({
      key: 'providers',
      node: (
        <div className="space-y-4">
          {buttonProviders.map((provider) => (
            <Button
              key={provider.type}
              onClick={() => {
                // The generic login route dispatches to the default
                // provider; non-default providers are selected explicitly.
                window.location.href = provider.isDefault
                  ? '/api/login'
                  : `/api/login?provider=${encodeURIComponent(provider.type)}`;
              }}
              variant={provider.isDefault ? 'default' : 'outline'}
              className="w-full"
              size="lg"
              data-testid={`button-login-${provider.type}`}
            >
              <LogIn className="mr-2 h-5 w-5" />
              {PROVIDER_BUTTON_LABELS[provider.type] ??
                `Sign in with ${provider.type}`}
            </Button>
          ))}
        </div>
      ),
    });
  }

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
          <CardTitle className="text-2xl font-bold" data-testid="text-login-title">{loginTitle}</CardTitle>
          {loginIntroHtml ? (
            <CardDescription>
              <span
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: loginIntroHtml }}
                data-testid="text-login-intro"
              />
            </CardDescription>
          ) : (
            <CardDescription data-testid="text-login-intro">
              Sign in to access all features.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/*
          {errorCode && (
            <div
              className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive"
              data-testid="text-login-error"
            >
              <div className="font-medium">Sign-in failed: {errorCode}</div>
              {errorDescription && <div className="mt-1 text-xs">{errorDescription}</div>}
            </div>
          )}

          {localEnabled && <LocalLoginForm />}

          {localEnabled && CLERK_ENABLED && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
          */}
          {sections.length === 0 && !providersData && !providersError ? (
            <div className="flex justify-center py-2" data-testid="loader-login-providers">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            sections.map((section, i) => (
              <div key={section.key} className="space-y-4">
                {i > 0 && <OrDivider />}
                {section.node}
              </div>
            ))
          )}

          {/*
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

                {workerRegistrationEnabled && (
                  <>
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
                  </>
                )}
              </SignedOut>
              <SignedIn>
                <ClerkNotProvisionedMessage />
              </SignedIn>
            </>
          ) : (
            <>
              {providers.length === 0 && (
                <div className="p-4 bg-muted rounded-lg text-sm text-center text-muted-foreground" data-testid="text-no-providers">
                  No sign-in providers are configured. Please contact your administrator.
                </div>
              )}
              {replitEnabled && (
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
              {oktaEnabled && (
                <Button
                  onClick={() => {
                    window.location.href = '/api/login?provider=okta';
                  }}
                  variant={replitEnabled ? 'outline' : 'default'}
                  className="w-full"
                  size="lg"
                  data-testid="button-login-okta"
                >
                  <LogIn className="mr-2 h-5 w-5" />
                  Sign in with Okta
                </Button>
              )}
              {samlEnabled && (
                <Button
                  onClick={() => {
                    window.location.href = '/api/login?provider=saml';
                  }}
                  variant="outline"
                  className="w-full"
                  size="lg"
                  data-testid="button-login-saml"
                >
                  <LogIn className="mr-2 h-5 w-5" />
                  Sign in with SAML
                </Button>
              )}
              {oktaEnabled && workerRegistrationEnabled && (
                <>
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
                    onClick={() => setLocation('/register')}
                    data-testid="button-login-register"
                  >
                    <UserPlus className="mr-2 h-5 w-5" />
                    Register as a Worker
                  </Button>
                </>
              )}
            </>
          */}
          {sections.length === 0 && providersError && (
            // Provider list unavailable — still give the user a way in via
            // the server-side default provider.
            <Button
              onClick={() => {
                window.location.href = '/api/login';
              }}
              className="w-full"
              size="lg"
              data-testid="button-login"
            >
              <LogIn className="mr-2 h-5 w-5" />
              Sign in
            </Button>
          )}

          <div className="mt-4 p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground text-center">
              Staff and employer accounts must be pre-authorized by an administrator.
              {clerkActive && ' Workers can register using the link above.'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
