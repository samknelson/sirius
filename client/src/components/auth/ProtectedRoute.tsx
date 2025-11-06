import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: string;
  policy?: string;
}

const POLICY_PERMISSIONS: Record<string, string[]> = {
  'bookmark': ['bookmark'],
  'workers.view': ['workers.view'],
  'workers.manage': ['workers.manage'],
  'employers.view': ['employers.view'],
  'employers.manage': ['employers.manage'],
  'variables.view': ['variables.view'],
  'variables.manage': ['variables.manage'],
  'benefits.view': ['benefits.view'],
  'benefits.manage': ['benefits.manage'],
  'admin.manage': ['admin.manage'],
  'masquerade': ['masquerade', 'admin'],
  'ledgerStripeEmployer': ['ledger.staff', 'ledger.employer'],
};

export default function ProtectedRoute({ children, permission, policy }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, hasPermission } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation('/login');
    }
  }, [isAuthenticated, isLoading, setLocation]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  // If not authenticated, don't render anything (redirect will happen via useEffect)
  if (!isAuthenticated) {
    return null;
  }

  // Check policy-based access
  if (policy) {
    const requiredPermissions = POLICY_PERMISSIONS[policy] || [];
    const hasAccess = hasPermission('admin') || requiredPermissions.some(p => hasPermission(p));
    
    if (!hasAccess) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Access Denied</h1>
            <p className="text-gray-600 dark:text-gray-400">
              You don't have permission to access this page.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Required: {requiredPermissions.join(' or ')} permission
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