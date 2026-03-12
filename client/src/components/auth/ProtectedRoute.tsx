import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, Shield } from 'lucide-react';
import { Redirect, useLocation } from 'wouter';
import AccessDenied from './AccessDenied';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getTabAccessRequirements, TabEntityType } from '@shared/tabRegistry';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: string;
  policy?: string;
  component?: string;
  entityId?: string;
  tabId?: string;
  entityType?: TabEntityType;
}

interface DetailedPolicyResult {
  policy: {
    id: string;
    name: string;
    description?: string;
    scope?: string;
    entityType?: string;
  };
  access: {
    granted: boolean;
    reason?: string;
  };
  evaluatedAt: string;
}

class PolicyCheckError extends Error {
  statusCode: number;
  apiMessage: string;
  policyId: string;
  
  constructor(message: string, statusCode: number, apiMessage: string, policyId: string) {
    super(message);
    this.name = 'PolicyCheckError';
    this.statusCode = statusCode;
    this.apiMessage = apiMessage;
    this.policyId = policyId;
  }
}

export default function ProtectedRoute({ children, permission, policy, component, entityId, tabId, entityType }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, authReady, hasPermission, hasComponent } = useAuth();
  const [location] = useLocation();

  // Resolve access requirements from tab registry if tabId is provided
  // This is the SINGLE SOURCE OF TRUTH for tab-linked routes
  const tabAccess = tabId && entityType ? getTabAccessRequirements(entityType, tabId) : null;
  
  // If tabId was provided but lookup failed, fail closed with warning
  const tabLookupFailed = !!(tabId && entityType && !tabAccess);
  if (tabLookupFailed) {
    console.error(
      `[ProtectedRoute] Tab lookup failed for tabId="${tabId}" entityType="${entityType}". ` +
      `This tab may not exist in the registry. Access denied (fail-closed).`
    );
  }
  
  // Use tab-derived access requirements if available, otherwise use explicit props
  const effectivePermission = tabAccess?.permission ?? permission;
  const effectivePolicy = tabAccess?.policyId ?? policy;
  const effectiveComponent = tabAccess?.component ?? component;

  // Use explicit entityId prop if provided, otherwise extract from URL based on entity patterns
  // This handles nested routes like /workers/:id/contacts by finding the ID after known prefixes
  const extractEntityInfoFromUrl = (path: string): { id?: string; type?: string } => {
    const segments = path.split('/').filter(Boolean);
    
    // Known entity URL patterns: /{entityType}/{id}/...
    const entityPrefixMap: Record<string, string> = {
      'workers': 'worker',
      'employers': 'employer',
      'providers': 'provider',
      'policies': 'policy',
      'events': 'event',
      'bargaining-units': 'bargaining_unit',
      'csgs': 'csg',
      'dispatch': 'dispatch',
      'ledger': 'ledger',
      'employer-contacts': 'employer_contact',
      'ea': 'ea',
      'sheet': 'edls_sheet',
    };
    
    for (let i = 0; i < segments.length - 1; i++) {
      if (entityPrefixMap[segments[i]]) {
        const potentialId = segments[i + 1];
        // Skip if the next segment is a known sub-route name (not an ID)
        const subRouteNames = ['new', 'create', 'list', 'search', 'all'];
        if (!subRouteNames.includes(potentialId)) {
          return { id: potentialId, type: entityPrefixMap[segments[i]] };
        }
      }
    }
    
    // Fall back to last segment
    return { id: segments.pop(), type: undefined };
  };
  
  const extractedInfo = extractEntityInfoFromUrl(location);
  const resourceId = entityId || extractedInfo.id;
  const detectedEntityType = entityType || extractedInfo.type;
  
  // Check policy via API if policy prop is provided
  const { data: policyResult, isLoading: isPolicyLoading, isError: isPolicyError, error: policyError } = useQuery<DetailedPolicyResult, PolicyCheckError>({
    queryKey: ['/api/access/policies', effectivePolicy, resourceId, detectedEntityType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (resourceId) {
        params.set('entityId', resourceId);
      }
      if (detectedEntityType) {
        params.set('entityType', detectedEntityType);
      }
      const url = `/api/access/policies/${effectivePolicy}${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        let apiMessage = 'Unknown error';
        try {
          const errorData = await response.json();
          apiMessage = errorData.message || errorData.error || 'Unknown error';
        } catch {
          apiMessage = response.statusText || 'Unknown error';
        }
        throw new PolicyCheckError(
          `Policy check failed: ${apiMessage}`,
          response.status,
          apiMessage,
          effectivePolicy || 'unknown'
        );
      }
      return response.json();
    },
    enabled: isAuthenticated && !!effectivePolicy,
    staleTime: 30000, // 30 seconds
    retry: 2,
  });

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
    // Save the current location to redirect back after login
    if (location !== '/login') {
      sessionStorage.setItem('redirectAfterLogin', location);
    }
    return <Redirect to="/login" />;
  }

  // Fail closed if tab lookup failed
  if (tabLookupFailed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-destructive" />
              <div>
                <CardTitle className="text-2xl">Access Configuration Error</CardTitle>
                <CardDescription>
                  Unable to verify access requirements for this page
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Tab Not Found in Registry</AlertTitle>
              <AlertDescription>
                The tab <span className="font-mono">{tabId}</span> for entity type <span className="font-mono">{entityType}</span> was not found in the tab registry.
              </AlertDescription>
            </Alert>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>What does this mean?</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  This route is configured to use tab-based access control, but the specified tab does not exist.
                </p>
                <p className="mt-2">This could mean:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>The tabId prop in the route does not match any tab in the registry</li>
                  <li>The entityType prop is incorrect for this route</li>
                  <li>The tab was removed from the registry but the route was not updated</li>
                </ul>
                <p className="mt-2 text-sm text-muted-foreground">
                  Access is denied (fail-closed) until this configuration is fixed.
                </p>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if required component is enabled
  if (effectiveComponent && !hasComponent(effectiveComponent)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-md p-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Feature Not Available</h1>
          <p className="text-gray-600 dark:text-gray-400">
            This feature is not currently enabled for this application.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Required component: {effectiveComponent}
          </p>
        </div>
      </div>
    );
  }

  // Show loading while checking policy
  if (effectivePolicy && isPolicyLoading) {
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
  if (effectivePolicy) {
    // If there was an error fetching policy, fail closed (deny access)
    if (isPolicyError) {
      const errorDetails = policyError instanceof PolicyCheckError ? policyError : null;
      const is404 = errorDetails?.statusCode === 404;
      
      return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
          <Card className="max-w-2xl w-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Shield className="h-8 w-8 text-destructive" />
                <div>
                  <CardTitle className="text-2xl">Access Check Failed</CardTitle>
                  <CardDescription>
                    Unable to verify your access permissions
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>
                  {is404 ? 'Policy Not Found' : 'Error Checking Access'}
                </AlertTitle>
                <AlertDescription>
                  {errorDetails?.apiMessage || 'An unexpected error occurred while checking permissions.'}
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Error Details
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Policy ID:</span>
                    <span className="font-mono">{errorDetails?.policyId || policy}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Status Code:</span>
                    <span className="font-mono">{errorDetails?.statusCode || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Resource ID:</span>
                    <span className="font-mono">{resourceId || 'None'}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">Current Path:</span>
                    <span className="font-mono text-xs">{location}</span>
                  </div>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>What does this mean?</AlertTitle>
                <AlertDescription className="space-y-2">
                  {is404 ? (
                    <>
                      <p>
                        The access policy <span className="font-mono">{errorDetails?.policyId || policy}</span> does not exist in the system.
                      </p>
                      <p className="mt-2">This could mean:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>The policy has not been registered in the application</li>
                        <li>There is a typo in the policy name</li>
                        <li>The feature requiring this policy is not fully configured</li>
                      </ul>
                    </>
                  ) : (
                    <>
                      <p>
                        An error occurred while checking your access permissions.
                      </p>
                      <p className="mt-2">Try refreshing the page. If the problem persists, contact your administrator.</p>
                    </>
                  )}
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      );
    }
    
    // If policy result is available, check if access is allowed
    if (policyResult && !policyResult.access.granted) {
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
  if (effectivePermission && !hasPermission(effectivePermission)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Access Denied</h1>
          <p className="text-gray-600 dark:text-gray-400">
            You don't have permission to access this page.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Required permission: {effectivePermission}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}