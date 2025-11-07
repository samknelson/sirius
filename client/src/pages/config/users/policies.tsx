import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, CheckCircle2, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';

// Access requirement types (mirrors server-side definition)
type AccessRequirement =
  | { type: 'authenticated' }
  | { type: 'permission'; key: string }
  | { type: 'anyPermission'; keys: string[] }
  | { type: 'allPermissions'; keys: string[] }
  | { type: 'component'; componentId: string }
  | { type: 'ownership'; resourceType: string; resourceIdParam?: string }
  | { type: 'anyOf'; options: AccessRequirement[] }
  | { type: 'allOf'; options: AccessRequirement[] }
  | { type: 'custom'; reason?: string };

interface Policy {
  id: string;
  name: string;
  description: string;
  requirements: AccessRequirement[];
}

function formatRequirement(req: AccessRequirement): { text: string; type: string } {
  switch (req.type) {
    case 'authenticated':
      return { text: 'User must be authenticated', type: 'auth' };
    
    case 'permission':
      return { text: `Requires permission: ${req.key}`, type: 'permission' };
    
    case 'anyPermission':
      return { 
        text: `Requires any of these permissions: ${req.keys.join(', ')}`, 
        type: 'permission' 
      };
    
    case 'allPermissions':
      return { 
        text: `Requires all of these permissions: ${req.keys.join(', ')}`, 
        type: 'permission' 
      };
    
    case 'component':
      return { 
        text: `Component "${req.componentId}" must be enabled`, 
        type: 'component' 
      };
    
    case 'ownership':
      return { 
        text: `User must own the ${req.resourceType}${req.resourceIdParam ? ` (ID from parameter: ${req.resourceIdParam})` : ''}`, 
        type: 'ownership' 
      };
    
    case 'anyOf':
      return { 
        text: `Must meet ANY of: ${req.options.map((opt: AccessRequirement) => formatRequirement(opt).text).join(' OR ')}`, 
        type: 'complex' 
      };
    
    case 'allOf':
      return { 
        text: `Must meet ALL of: ${req.options.map((opt: AccessRequirement) => formatRequirement(opt).text).join(' AND ')}`, 
        type: 'complex' 
      };
    
    case 'custom':
      return { 
        text: req.reason || 'Custom requirement check', 
        type: 'custom' 
      };
    
    default:
      return { text: 'Unknown requirement', type: 'unknown' };
  }
}

function getRequirementBadgeVariant(type: string) {
  switch (type) {
    case 'auth':
      return 'default';
    case 'permission':
      return 'secondary';
    case 'component':
      return 'outline';
    case 'ownership':
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
