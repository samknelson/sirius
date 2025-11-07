import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Redirect } from 'wouter';
import AccessDenied from './AccessDenied';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: string;
  policy?: string;
}

interface DetailedPolicyResult {
  policy: {
    name: string;
    description?: string;
  };
  allowed: boolean;
  evaluatedAt: string;
  adminBypass: boolean;
  requirements: Array<{
    type: string;
    description: string;
    status: 'passed' | 'failed' | 'skipped';
    reason?: string;
    details?: any;
  }>;
}

export default function ProtectedRoute({ children, permission, policy }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, authReady, hasPermission } = useAuth();

  // Debug logging
  console.log('[ProtectedRoute] Rendered with:', { permission, policy, isAuthenticated, authReady });

  // Check policy via API if policy prop is provided
  const { data: policyResult, isLoading: isPolicyLoading, isError: isPolicyError } = useQuery<DetailedPolicyResult>({
    queryKey: ['/api/access/policies', policy],
    enabled: isAuthenticated && !!policy,
    staleTime: 30000, // 30 seconds
    retry: 2,
  });

  console.log('[ProtectedRoute] Policy check:', { policy, policyResult, isPolicyLoading, isPolicyError });

  // Show loading state while auth is not ready
  if (!authReady || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  // If auth is ready and user is not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  // Show loading while checking policy
  if (policy && isPolicyLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Checking permissions...</span>
        </div>
      </div>
    );
  }

  // Check policy-based access via API
  if (policy) {
    // If there was an error fetching policy, fail closed (deny access)
    if (isPolicyError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
          <div className="text-center max-w-md p-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Access Check Failed</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Unable to verify your access permissions. Please try refreshing the page.
            </p>
            <p className="text-sm text-muted-foreground">
              If this problem persists, please contact your administrator.
            </p>
          </div>
        </div>
      );
    }
    
    // If policy result is available, check if access is allowed
    if (policyResult && !policyResult.allowed) {
      return <AccessDenied policyResult={policyResult} />;
    }
    
    // If no result yet and still loading, wait (handled above)
    // If no result and not loading/error, something went wrong - fail closed
    if (!policyResult && !isPolicyLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
          <div className="text-center max-w-md p-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Access Denied</h1>
            <p className="text-gray-600 dark:text-gray-400">
              Unable to verify access permissions.
            </p>
          </div>
        </div>
      );
    }
  }

  // If a specific permission is required, check if user has it
  if (permission && !hasPermission(permission)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Access Denied</h1>
          <p className="text-gray-600 dark:text-gray-400">
            You don't have permission to access this page.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Required permission: {permission}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}