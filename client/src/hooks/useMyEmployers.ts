import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

interface MyEmployer {
  id: string;
  name: string;
}

interface UseMyEmployersReturn {
  employers: MyEmployer[];
  isLoading: boolean;
  isError: boolean;
  hasSingleEmployer: boolean;
  hasMultipleEmployers: boolean;
  hasEmployers: boolean;
}

export function useMyEmployers(): UseMyEmployersReturn {
  const { user } = useAuth();
  // Enabled when user is logged in - API returns only their associated employers
  const enabled = !!user;

  const query = useQuery<MyEmployer[]>({
    queryKey: ['/api/my-employers'],
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const employers = query.data ?? [];
  const isLoading = enabled ? query.isLoading : false;
  const hasEmployers = !isLoading && employers.length > 0;

  return {
    employers,
    isLoading,
    isError: query.isError,
    hasSingleEmployer: hasEmployers && employers.length === 1,
    hasMultipleEmployers: hasEmployers && employers.length > 1,
    hasEmployers,
  };
}
