import { createContext, useContext, useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { 
  type TerminologyDictionary, 
  type TermOptions,
  resolveTerm,
  getDefaultTerminology,
  mergeTerminology,
  terminologySchema,
  TERMINOLOGY_VARIABLE_NAME,
} from '@shared/terminology';
import { useVariableValue, parseVariableJson } from '@/lib/use-variable';

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
  // Public variable; the value may be stored as a JSON string. Merge with
  // the shared default term registry client-side; invalid/missing values
  // fall back to defaults.
  const { data, isLoading } = useVariableValue(TERMINOLOGY_VARIABLE_NAME, {
    staleTime: 1000 * 60 * 30,
  });

  const terminology = useMemo(() => {
    const parsed = parseVariableJson(data);
    const result = terminologySchema.safeParse(parsed);
    if (result.success) {
      return mergeTerminology(result.data);
    }
    return getDefaultTerminology();
  }, [data]);

  const term = useCallback((key: string, options: TermOptions = {}): string => {
    return resolveTerm(terminology, key, options);
  }, [terminology]);

  const updateMutation = useMutation({
    mutationFn: async (terms: Partial<TerminologyDictionary>) => {
      return await apiRequest('PUT', '/api/terminology', { terminology: terms });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/variables/by-name', TERMINOLOGY_VARIABLE_NAME] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/terminology/reset');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/variables/by-name', TERMINOLOGY_VARIABLE_NAME] });
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
