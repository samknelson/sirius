/**
 * useAccessCheck Hook
 * 
 * Provides on-demand entity access checking with client-side caching.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

interface AccessCheckResult {
  granted: boolean;
  reason?: string;
}

interface UseAccessCheckReturn {
  canAccess: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Check access to a specific entity
 * 
 * @param policyId - Policy to evaluate (e.g., 'worker.view', 'employer.view')
 * @param entityId - Entity ID to check access for
 * @param options - Additional options
 * @returns Access check result with loading state
 * 
 * @example
 * ```tsx
 * const { canAccess, isLoading } = useAccessCheck('worker.view', workerId);
 * 
 * if (isLoading) return <Skeleton />;
 * if (!canAccess) return <AccessDenied />;
 * return <WorkerDetails />;
 * ```
 */
export function useAccessCheck(
  policyId: string,
  entityId: string | undefined,
  options: { enabled?: boolean } = {}
): UseAccessCheckReturn {
  const { user } = useAuth();
  const hasValidEntityId = !!entityId && entityId.length > 0;
  const enabled = options.enabled !== false && hasValidEntityId && !!user;

  const query = useQuery<AccessCheckResult>({
    // Only include entityId in queryKey when it's valid to prevent bad cache entries
    queryKey: hasValidEntityId 
      ? ['/api/access/check', { policyId, entityId }]
      : ['/api/access/check', { policyId, entityId: '__disabled__' }],
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes - matches server cache TTL
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: false, // Don't retry on access denied
  });

  return {
    canAccess: query.data?.granted ?? false,
    isLoading: enabled ? query.isLoading : false,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Batch check access to multiple entities
 * 
 * @param policyId - Policy to evaluate
 * @param entityIds - Array of entity IDs to check
 * @returns Map of entity ID to access result
 */
export function useAccessCheckBatch(
  policyId: string,
  entityIds: string[],
  options: { enabled?: boolean } = {}
): {
  accessMap: Map<string, boolean>;
  isLoading: boolean;
  isError: boolean;
} {
  const { user } = useAuth();
  const enabled = options.enabled !== false && entityIds.length > 0 && !!user;

  const sortedIds = [...entityIds].sort();
  const query = useQuery<{ results: Record<string, AccessCheckResult> }>({
    queryKey: ['/api/access/check-batch', { policyId, entityIds: sortedIds.join(',') }],
    queryFn: async () => {
      const response = await fetch('/api/access/check-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: policyId, entityIds: sortedIds }),
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to check batch access');
      }
      return response.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const accessMap = new Map<string, boolean>();
  if (query.data?.results) {
    for (const [entityId, result] of Object.entries(query.data.results)) {
      accessMap.set(entityId, result.granted);
    }
  }

  return {
    accessMap,
    isLoading: enabled ? query.isLoading : false,
    isError: query.isError,
  };
}

/**
 * Helper hook that combines access check with conditional rendering
 * Returns null content when access is denied or loading
 */
export function useAccessGate(
  policyId: string,
  entityId: string | undefined
): {
  canRender: boolean;
  isChecking: boolean;
  AccessDenied: () => JSX.Element | null;
} {
  const { canAccess, isLoading } = useAccessCheck(policyId, entityId);

  return {
    canRender: canAccess && !isLoading,
    isChecking: isLoading,
    AccessDenied: () => null, // Render nothing for access denied by default
  };
}
