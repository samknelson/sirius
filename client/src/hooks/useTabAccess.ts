import { useQuery } from "@tanstack/react-query";
import { 
  TabEntityType, 
  TabAccessResult, 
  TabDefinition,
  workerTabs,
  workerIdentitySubTabs,
  workerContactSubTabs,
  workerCommSubTabs,
  workerEmploymentSubTabs,
  workerBenefitsSubTabs,
  workerUnionSubTabs,
  workerDispatchSubTabs,
  employerTabs,
  employerAccountingSubTabs,
  employerUnionSubTabs,
  providerTabs,
  buildTabHref,
} from "@shared/tabRegistry";
import { apiRequest } from "@/lib/queryClient";

interface TabAccessResponse {
  tabs: TabAccessResult[];
}

interface UseTabAccessOptions {
  entityType: TabEntityType;
  entityId: string | undefined;
  enabled?: boolean;
}

interface TabWithAccess extends TabDefinition {
  href: string;
  granted: boolean;
  reason?: string;
}

interface UseTabAccessResult {
  isLoading: boolean;
  isError: boolean;
  tabAccess: Map<string, boolean>;
  hasAccess: (tabId: string) => boolean;
  filterTabs: <T extends TabDefinition>(tabs: T[]) => (T & { href: string })[];
  getTabsWithAccess: (tabs: TabDefinition[]) => TabWithAccess[];
}

/**
 * Hook to fetch and manage tab access for an entity
 * Returns filtered tabs based on the user's actual access permissions
 */
export function useTabAccess({ 
  entityType, 
  entityId, 
  enabled = true 
}: UseTabAccessOptions): UseTabAccessResult {
  const { data, isLoading, isError } = useQuery<TabAccessResponse>({
    queryKey: ['/api/access/tabs', entityType, entityId],
    queryFn: async () => {
      // apiRequest already returns parsed JSON, don't call .json() again
      return await apiRequest('POST', '/api/access/tabs', {
        entityType,
        entityId,
      });
    },
    enabled: enabled && !!entityId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const tabAccess = new Map<string, boolean>();
  if (data?.tabs) {
    for (const tab of data.tabs) {
      tabAccess.set(tab.tabId, tab.granted);
    }
  }

  // Helper function to check if a specific tab is accessible
  const hasAccess = (tabId: string): boolean => {
    return tabAccess.get(tabId) === true;
  };

  const filterTabs = <T extends TabDefinition>(tabs: T[]): (T & { href: string })[] => {
    if (isLoading || !data?.tabs || !entityId) {
      return [];
    }

    return tabs
      .filter(tab => tabAccess.get(tab.id) === true)
      .map(tab => ({
        ...tab,
        href: buildTabHref(tab.hrefTemplate, entityId),
      }));
  };

  const getTabsWithAccess = (tabs: TabDefinition[]): TabWithAccess[] => {
    if (!entityId) return [];

    return tabs.map(tab => ({
      ...tab,
      href: buildTabHref(tab.hrefTemplate, entityId),
      granted: tabAccess.get(tab.id) ?? false,
      reason: data?.tabs.find(t => t.tabId === tab.id)?.reason,
    }));
  };

  return {
    isLoading,
    isError,
    tabAccess,
    hasAccess,
    filterTabs,
    getTabsWithAccess,
  };
}

/**
 * Hook specifically for worker entity tabs
 */
export function useWorkerTabAccess(workerId: string | undefined, enabled = true) {
  const access = useTabAccess({ 
    entityType: 'worker', 
    entityId: workerId, 
    enabled 
  });

  return {
    ...access,
    mainTabs: access.filterTabs(workerTabs),
    identitySubTabs: access.filterTabs(workerIdentitySubTabs),
    contactSubTabs: access.filterTabs(workerContactSubTabs),
    commSubTabs: access.filterTabs(workerCommSubTabs),
    employmentSubTabs: access.filterTabs(workerEmploymentSubTabs),
    benefitsSubTabs: access.filterTabs(workerBenefitsSubTabs),
    unionSubTabs: access.filterTabs(workerUnionSubTabs),
    dispatchSubTabs: access.filterTabs(workerDispatchSubTabs),
  };
}

/**
 * Hook specifically for employer entity tabs
 */
export function useEmployerTabAccess(employerId: string | undefined, enabled = true) {
  const access = useTabAccess({ 
    entityType: 'employer', 
    entityId: employerId, 
    enabled 
  });

  return {
    ...access,
    mainTabs: access.filterTabs(employerTabs),
    accountingSubTabs: access.filterTabs(employerAccountingSubTabs),
    unionSubTabs: access.filterTabs(employerUnionSubTabs),
  };
}

/**
 * Hook specifically for provider entity tabs
 */
export function useProviderTabAccess(providerId: string | undefined, enabled = true) {
  const access = useTabAccess({ 
    entityType: 'provider', 
    entityId: providerId, 
    enabled 
  });

  return {
    ...access,
    mainTabs: access.filterTabs(providerTabs),
  };
}
