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
                    <div className="space-y-1">
                      {policy.requirements.map((req, index) => {
                        const formatted = formatRequirement(req);
                        return (
                          <div
                            key={index}
                            className="flex items-center gap-2 flex-wrap text-sm"
                            data-testid={`requirement-${policy.id}-${index}`}
                          >
                            <Badge 
                              variant={getRequirementBadgeVariant(formatted.type)}
                              className="text-xs"
                            >
                              {formatted.type}
                            </Badge>
                            <span>{formatted.text}</span>
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
