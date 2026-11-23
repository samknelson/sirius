import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

export function useCommViewerKey() {
  const { user, permissions, components } = useAuth();
  // Permission/component changes for the same user are also new audiences.
  return JSON.stringify([
    user?.id ?? null, [...permissions].sort(), [...components].sort(),
  ]);
}

export function useCommViewAccess(commId: string) {
  const { user } = useAuth();
  const viewerKey = useCommViewerKey();
  const query = useQuery<{ granted: boolean }>({
    queryKey: ['/api/access/check', 'comm.view', commId, viewerKey],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ policy: 'comm.view', entityId: commId });
      const response = await fetch(`/api/access/check?${params}`, {
        credentials: 'include', cache: 'no-store', signal,
      });
      if (!response.ok) throw new Error('Unable to check communication access');
      return response.json();
    },
    enabled: !!user && !!commId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return {
    ...query,
    viewerKey,
    canView: !!user && query.isSuccess && query.data.granted === true,
  };
}
