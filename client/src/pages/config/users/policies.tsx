import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AccessRequirement, AccessCondition, Policy } from '@/lib/policy-types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ConditionPart {
  text: string;
  type: string;
}

/**
 * Format a single access condition into human-readable parts
 * Returns an array of parts, each with its own type for proper badge rendering
 */
function formatConditionParts(condition: AccessCondition): ConditionPart[] {
  const parts: ConditionPart[] = [];
  
  if (condition.authenticated) {
    parts.push({ text: 'User must be authenticated', type: 'auth' });
  }
  
  if (condition.permission) {
    parts.push({ text: `Requires permission: ${condition.permission}`, type: 'permission' });
  }
  
  if (condition.anyPermission && condition.anyPermission.length > 0) {
    parts.push({ text: `Requires any of: ${condition.anyPermission.join(', ')}`, type: 'permission' });
  }
  
  if (condition.allPermissions && condition.allPermissions.length > 0) {
    parts.push({ text: `Requires all of: ${condition.allPermissions.join(', ')}`, type: 'permission' });
  }
  
  if (condition.component) {
    parts.push({ text: `Component "${condition.component}" must be enabled`, type: 'component' });
  }
  
  if (condition.linkage) {
    parts.push({ text: `Linkage: ${condition.linkage}`, type: 'linkage' });
  }
  
  if (condition.policy) {
    parts.push({ text: `Requires policy: ${condition.policy}`, type: 'policy' });
  }
  
  if (parts.length === 0) {
    return [{ text: 'No specific requirements', type: 'unknown' }];
  }
  
  return parts;
}

/**
 * Format a single access condition into human-readable text (legacy for complex compositions)
 */
function formatCondition(condition: AccessCondition): { text: string; type: string } {
  const parts = formatConditionParts(condition);
  if (parts.length === 0) {
    return { text: 'No specific requirements', type: 'unknown' };
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return { 
    text: parts.map(p => p.text).join(' AND '), 
    type: parts.length > 1 ? 'complex' : parts[0].type 
  };
}

/**
 * Format an access requirement into an array of parts for rendering with individual badges
 */
function formatRequirementParts(req: AccessRequirement): ConditionPart[] {
  // Check if it's an "any" composition
  if ('any' in req && Array.isArray(req.any)) {
    const formatted = req.any.map(c => formatCondition(c).text);
    return [{ 
      text: `Must meet ANY of: ${formatted.join(' OR ')}`, 
      type: 'complex' 
    }];
  }
  
  // Check if it's an "all" composition
  if ('all' in req && Array.isArray(req.all)) {
    const formatted = req.all.map(c => formatCondition(c).text);
    return [{ 
      text: `Must meet ALL of: ${formatted.join(' AND ')}`, 
      type: 'complex' 
    }];
  }
  
  // Otherwise it's a single condition - return individual parts
  return formatConditionParts(req as AccessCondition);
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
    case 'policy':
      return 'outline';
    case 'complex':
      return 'default';
    default:
      return 'secondary';
  }
}

export default function PoliciesPage() {
  const [filterText, setFilterText] = useState('');
  
  const { data: policies = [], isLoading } = useQuery<Policy[]>({
    queryKey: ["/api/access/policies"],
  });

  const filteredAndSortedPolicies = useMemo(() => {
    const lowerFilter = filterText.toLowerCase().trim();
    
    return policies
      .filter(policy => {
        if (!lowerFilter) return true;
        return (
          policy.id.toLowerCase().includes(lowerFilter) ||
          (policy.description && policy.description.toLowerCase().includes(lowerFilter))
        );
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [policies, filterText]);

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
            Declarative access control policies used throughout the application. Users with the "admin" permission bypass all policy checks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by name..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="pl-9"
                data-testid="input-filter-policies"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Showing {filteredAndSortedPolicies.length} of {policies.length} policies
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Name</TableHead>
                <TableHead className="w-[300px]">Description</TableHead>
                <TableHead>Requirements</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedPolicies.map((policy) => (
                <TableRow key={policy.id} data-testid={`policy-${policy.id}`}>
                  <TableCell className="font-mono text-sm" data-testid={`policy-id-${policy.id}`}>
                    {policy.id}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {policy.description || '-'}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      {policy.requirements.map((req, reqIndex) => {
                        const parts = formatRequirementParts(req);
                        return (
                          <div
                            key={reqIndex}
                            className="flex items-start gap-2 flex-wrap text-sm"
                            data-testid={`requirement-${policy.id}-${reqIndex}`}
                          >
                            {parts.map((part, partIndex) => (
                              <div key={partIndex} className="flex items-center gap-1">
                                {partIndex > 0 && <span className="text-muted-foreground text-xs">AND</span>}
                                <Badge 
                                  variant={getRequirementBadgeVariant(part.type)}
                                  className="text-xs"
                                >
                                  {part.type}
                                </Badge>
                                <span>{part.text}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
