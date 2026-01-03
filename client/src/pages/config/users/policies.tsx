import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, CheckCircle2, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { AccessRequirement, AccessCondition, Policy } from '@/lib/policy-types';

/**
 * Format a single access condition into human-readable text
 */
function formatCondition(condition: AccessCondition): { text: string; type: string } {
  const parts: string[] = [];
  let type = 'auth';
  
  if (condition.authenticated) {
    parts.push('User must be authenticated');
  }
  
  if (condition.permission) {
    parts.push(`Requires permission: ${condition.permission}`);
    type = 'permission';
  }
  
  if (condition.anyPermission && condition.anyPermission.length > 0) {
    parts.push(`Requires any of: ${condition.anyPermission.join(', ')}`);
    type = 'permission';
  }
  
  if (condition.allPermissions && condition.allPermissions.length > 0) {
    parts.push(`Requires all of: ${condition.allPermissions.join(', ')}`);
    type = 'permission';
  }
  
  if (condition.component) {
    parts.push(`Component "${condition.component}" must be enabled`);
    type = 'component';
  }
  
  if (condition.linkage) {
    parts.push(`Linkage: ${condition.linkage}`);
    type = 'linkage';
  }
  
  if (parts.length === 0) {
    return { text: 'No specific requirements', type: 'unknown' };
  }
  
  return { text: parts.join(' AND '), type };
}

/**
 * Format an access requirement (which may be a condition or composition) into human-readable text
 */
function formatRequirement(req: AccessRequirement): { text: string; type: string } {
  // Check if it's an "any" composition
  if ('any' in req && Array.isArray(req.any)) {
    const formatted = req.any.map(c => formatCondition(c).text);
    return { 
      text: `Must meet ANY of: ${formatted.join(' OR ')}`, 
      type: 'complex' 
    };
  }
  
  // Check if it's an "all" composition
  if ('all' in req && Array.isArray(req.all)) {
    const formatted = req.all.map(c => formatCondition(c).text);
    return { 
      text: `Must meet ALL of: ${formatted.join(' AND ')}`, 
      type: 'complex' 
    };
  }
  
  // Otherwise it's a single condition
  return formatCondition(req as AccessCondition);
}

function getRequirementBadgeVariant(type: string) {
  switch (type) {
    case 'auth':
      return 'default';
    case 'permission':
      return 'secondary';
    case 'component':
      return 'outline';
    case 'linkage':
      return 'destructive';
    case 'complex':
      return 'default';
    default:
      return 'secondary';
  }
}

export default function PoliciesPage() {
  const { data: policies = [], isLoading } = useQuery<Policy[]>({
    queryKey: ["/api/access/policies"],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 max-w-7xl">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading policies...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" data-testid="heading-policies">
          Access Policies
        </h1>
        <p className="text-muted-foreground mt-2">
          System access policies and their requirements. All policies automatically grant access to users with the "admin" permission.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Policies
          </CardTitle>
          <CardDescription>
            Declarative access control policies used throughout the application
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {policies.map((policy) => (
              <div
                key={policy.id}
                className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-900"
                data-testid={`policy-${policy.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500" />
                      {policy.name}
                    </h3>
                    {policy.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {policy.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" data-testid={`policy-id-${policy.id}`}>
                    {policy.id}
                  </Badge>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <AlertCircle className="h-4 w-4" />
                    Requirements:
                  </div>
                  <ul className="space-y-2 ml-6">
                    {policy.requirements.map((req, index) => {
                      const formatted = formatRequirement(req);
                      return (
                        <li
                          key={index}
                          className="flex items-start gap-2 text-sm"
                          data-testid={`requirement-${policy.id}-${index}`}
                        >
                          <span className="mt-1">•</span>
                          <div className="flex-1 flex items-center gap-2 flex-wrap">
                            <span>{formatted.text}</span>
                            <Badge 
                              variant={getRequirementBadgeVariant(formatted.type)}
                              className="text-xs"
                            >
                              {formatted.type}
                            </Badge>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-muted-foreground italic">
                    Note: Users with the "admin" permission bypass all policy checks and are automatically granted access.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
