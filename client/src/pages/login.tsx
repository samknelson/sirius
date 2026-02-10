import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, LogIn, Cloud } from 'lucide-react';

interface AuthProviders {
  providers: {
    replit: boolean;
    saml: boolean;
    cognito: boolean;
  };
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login, isAuthenticated, isLoading } = useAuth();

  const { data: authProviders, isLoading: providersLoading } = useQuery<AuthProviders>({
    queryKey: ['/api/auth/providers'],
    retry: false,
  });

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

  const handleCognitoLogin = () => {
    window.location.href = '/api/auth/cognito';
  };

  const handleSamlLogin = () => {
    window.location.href = '/api/saml/login';
  };

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

  const hasMultipleProviders = authProviders && 
    [authProviders.providers.replit, authProviders.providers.cognito, authProviders.providers.saml]
      .filter(Boolean).length > 1;

  const isPreview = window.location.hostname.includes('preview') || 
    window.location.hostname.includes('pr-') ||
    new URLSearchParams(window.location.search).has('preview');

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      {isPreview && (
        <div className="fixed top-0 left-0 right-0 bg-amber-500 text-black text-center py-2 px-4 font-semibold text-sm z-50">
          PREVIEW ENVIRONMENT - This is a test deployment from a pull request
        </div>
      )}
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
          {authProviders?.providers.cognito && (
            <Button 
              onClick={handleCognitoLogin} 
              className="w-full" 
              size="lg"
              data-testid="button-login-cognito"
            >
              <Cloud className="mr-2 h-5 w-5" />
              Sign in with AWS
            </Button>
          )}

          {authProviders?.providers.replit && (
            <Button 
              onClick={login} 
              className="w-full" 
              size="lg"
              variant={authProviders?.providers.cognito ? "outline" : "default"}
              data-testid="button-login"
            >
              <LogIn className="mr-2 h-5 w-5" />
              Sign in with Replit
            </Button>
          )}

          {authProviders?.providers.saml && (
            <Button 
              onClick={handleSamlLogin} 
              className="w-full" 
              size="lg"
              variant="outline"
              data-testid="button-login-saml"
            >
              <LogIn className="mr-2 h-5 w-5" />
              Sign in with SSO
            </Button>
          )}

          {providersLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Loading login options...</span>
            </div>
          )}

          {!providersLoading && !authProviders?.providers.replit && !authProviders?.providers.cognito && !authProviders?.providers.saml && (
            <div className="p-4 bg-destructive/10 rounded-lg">
              <p className="text-sm text-destructive text-center">
                No authentication providers are configured. Please contact your administrator.
              </p>
            </div>
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