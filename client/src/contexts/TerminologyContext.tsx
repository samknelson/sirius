import { createContext, useContext, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { 
  type TerminologyDictionary, 
  type TermOptions,
  resolveTerm,
  getDefaultTerminology 
} from '@shared/terminology';

interface TerminologyContextType {
  terminology: TerminologyDictionary;
  term: (key: string, options?: TermOptions) => string;
  isLoading: boolean;
  updateTerminology: (terms: Partial<TerminologyDictionary>) => Promise<void>;
  resetTerminology: () => Promise<void>;
  isUpdating: boolean;
}

const TerminologyContext = createContext<TerminologyContextType | undefined>(undefined);

export function useTerminology() {
  const context = useContext(TerminologyContext);
  if (context === undefined) {
    throw new Error('useTerminology must be used within a TerminologyProvider');
  }
  return context;
}

export function useTerm() {
  const { term } = useTerminology();
  return term;
}

export function TerminologyProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery<{ terminology: TerminologyDictionary }>({
    queryKey: ['/api/terminology'],
    staleTime: 1000 * 60 * 30,
  });

  const terminology = data?.terminology ?? getDefaultTerminology();

  const term = useCallback((key: string, options: TermOptions = {}): string => {
    return resolveTerm(terminology, key, options);
  }, [terminology]);

  const updateMutation = useMutation({
    mutationFn: async (terms: Partial<TerminologyDictionary>) => {
      return await apiRequest('PUT', '/api/terminology', { terminology: terms });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/terminology'] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/terminology/reset');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/terminology'] });
    },
  });

  const updateTerminology = async (terms: Partial<TerminologyDictionary>) => {
    await updateMutation.mutateAsync(terms);
  };

  const resetTerminology = async () => {
    await resetMutation.mutateAsync();
  };

  return (
    <TerminologyContext.Provider value={{
      terminology,
      term,
      isLoading,
      updateTerminology,
      resetTerminology,
      isUpdating: updateMutation.isPending || resetMutation.isPending,
    }}>
      {children}
    </TerminologyContext.Provider>
  );
}
