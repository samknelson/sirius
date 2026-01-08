import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { 
  TabEntityType, 
  TabAccessResult, 
  HierarchicalTab,
  getTabTreeForEntity,
  buildTabHref,
} from "@shared/tabRegistry";
import { apiRequest } from "@/lib/queryClient";
import { useTerm } from "@/contexts/TerminologyContext";

interface TabAccessResponse {
  tabs: TabAccessResult[];
}

interface UseTabAccessOptions {
  entityType: TabEntityType;
  entityId: string | undefined;
  enabled?: boolean;
}

/**
 * A tab with href resolved and access information
 */
export interface ResolvedTab {
  id: string;
  label: string;
  href: string;
  hasChildren: boolean;
  children?: ResolvedTab[];
}

/**
 * Result from useTabAccess hook - provides filtered hierarchical tabs
 */
interface UseTabAccessResult {
  isLoading: boolean;
  isError: boolean;
  /** All accessible root tabs with their accessible children */
  tabs: ResolvedTab[];
  /** Map of parent tab IDs to their accessible children (for easy sub-tab access) */
  subTabs: Record<string, ResolvedTab[]>;
  /** Check if a specific tab is accessible */
  hasAccess: (tabId: string) => boolean;
  /** Get the root tab for a given tab ID (returns the tab itself if it's a root) */
  getActiveRoot: (activeTabId: string) => ResolvedTab | undefined;
  /** Get children of a root tab */
  getChildren: (rootTabId: string) => ResolvedTab[];
  /** Check if a tab ID belongs to a root's children */
  isChildOfRoot: (tabId: string, rootId: string) => boolean;
}

/**
 * Hook to fetch and manage tab access for an entity
 * Returns a filtered hierarchical tree based on the user's actual access permissions
 */
export function useTabAccess({ 
  entityType, 
  entityId, 
  enabled = true 
}: UseTabAccessOptions): UseTabAccessResult {
  const term = useTerm();
  
  const { data, isLoading, isError } = useQuery<TabAccessResponse>({
    queryKey: ['/api/access/tabs', entityType, entityId],
    queryFn: async () => {
      return await apiRequest('POST', '/api/access/tabs', {
        entityType,
        entityId,
      });
    },
    enabled: enabled && !!entityId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const accessMap = useMemo(() => {
    const map = new Map<string, boolean>();
    if (data?.tabs) {
      for (const tab of data.tabs) {
        map.set(tab.tabId, tab.granted);
      }
    }
    return map;
  }, [data?.tabs]);

  const hasAccess = (tabId: string): boolean => {
    return accessMap.get(tabId) === true;
  };

  const filteredTree = useMemo((): ResolvedTab[] => {
    if (isLoading || !data?.tabs || !entityId) {
      return [];
    }

    const tree = getTabTreeForEntity(entityType);
    
    const filterAndResolve = (tabs: HierarchicalTab[]): ResolvedTab[] => {
      return tabs
        .filter(tab => accessMap.get(tab.id) === true)
        .map(tab => {
          const filteredChildren = tab.children 
            ? filterAndResolve(tab.children)
            : undefined;
          
          // Apply terminology substitution if termKey is defined
          const label = tab.termKey 
            ? term(tab.termKey, { plural: tab.termPlural })
            : tab.label;
          
          return {
            id: tab.id,
            label,
            href: buildTabHref(tab.hrefTemplate, entityId),
            hasChildren: (filteredChildren?.length ?? 0) > 0,
            children: filteredChildren && filteredChildren.length > 0 ? filteredChildren : undefined,
          };
        });
    };

    return filterAndResolve(tree);
  }, [entityType, entityId, isLoading, data?.tabs, accessMap, term]);

  const getActiveRoot = (activeTabId: string): ResolvedTab | undefined => {
    for (const rootTab of filteredTree) {
      if (rootTab.id === activeTabId) {
        return rootTab;
      }
      if (rootTab.children) {
        const isChild = rootTab.children.some(child => child.id === activeTabId);
        if (isChild) {
          return rootTab;
        }
      }
    }
    return undefined;
  };

  const getChildren = (rootTabId: string): ResolvedTab[] => {
    const root = filteredTree.find(tab => tab.id === rootTabId);
    return root?.children ?? [];
  };

  const isChildOfRoot = (tabId: string, rootId: string): boolean => {
    const root = filteredTree.find(tab => tab.id === rootId);
    if (!root || !root.children) return false;
    return root.children.some(child => child.id === tabId);
  };

  const subTabs = useMemo(() => {
    const result: Record<string, ResolvedTab[]> = {};
    for (const tab of filteredTree) {
      if (tab.children && tab.children.length > 0) {
        result[tab.id] = tab.children;
      }
    }
    return result;
  }, [filteredTree]);

  return {
    isLoading,
    isError,
    tabs: filteredTree,
    subTabs,
    hasAccess,
    getActiveRoot,
    getChildren,
    isChildOfRoot,
  };
}

/**
 * Hook specifically for worker entity tabs
 */
export function useWorkerTabAccess(workerId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'worker', 
    entityId: workerId, 
    enabled 
  });
}

/**
 * Hook specifically for employer entity tabs
 */
export function useEmployerTabAccess(employerId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'employer', 
    entityId: employerId, 
    enabled 
  });
}

/**
 * Hook specifically for provider entity tabs
 */
export function useProviderTabAccess(providerId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'provider', 
    entityId: providerId, 
    enabled 
  });
}

/**
 * Hook specifically for policy entity tabs
 */
export function usePolicyTabAccess(policyId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'policy', 
    entityId: policyId, 
    enabled 
  });
}

/**
 * Hook specifically for event entity tabs
 */
export function useEventTabAccess(eventId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'event', 
    entityId: eventId, 
    enabled 
  });
}

/**
 * Hook specifically for bargaining unit entity tabs
 */
export function useBargainingUnitTabAccess(bargainingUnitId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'bargaining_unit', 
    entityId: bargainingUnitId, 
    enabled 
  });
}

/**
 * Hook specifically for BTU CSG entity tabs
 */
export function useBtuCsgTabAccess(csgId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'btu_csg', 
    entityId: csgId, 
    enabled 
  });
}

/**
 * Hook specifically for cron job entity tabs
 */
export function useCronJobTabAccess(jobName: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'cron_job', 
    entityId: jobName, 
    enabled 
  });
}

/**
 * Hook specifically for dispatch job entity tabs
 */
export function useDispatchJobTabAccess(jobId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'dispatch_job', 
    entityId: jobId, 
    enabled 
  });
}

/**
 * Hook specifically for dispatch job type entity tabs
 */
export function useDispatchJobTypeTabAccess(jobTypeId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'dispatch_job_type', 
    entityId: jobTypeId, 
    enabled 
  });
}

/**
 * Hook specifically for ledger account entity tabs
 */
export function useLedgerAccountTabAccess(accountId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'ledger_account', 
    entityId: accountId, 
    enabled 
  });
}

/**
 * Hook specifically for ledger payment entity tabs
 */
export function useLedgerPaymentTabAccess(paymentId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'ledger_payment', 
    entityId: paymentId, 
    enabled 
  });
}

/**
 * Hook specifically for trust benefit entity tabs
 */
export function useTrustBenefitTabAccess(benefitId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'trust_benefit', 
    entityId: benefitId, 
    enabled 
  });
}

/**
 * Hook specifically for worker hours entity tabs
 */
export function useWorkerHoursTabAccess(hoursId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'worker_hours', 
    entityId: hoursId, 
    enabled 
  });
}

/**
 * Hook specifically for employer contact entity tabs
 */
export function useEmployerContactTabAccess(contactId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'employer_contact', 
    entityId: contactId, 
    enabled 
  });
}

/**
 * Hook specifically for trust provider contact entity tabs
 */
export function useProviderContactTabAccess(contactId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'provider_contact', 
    entityId: contactId, 
    enabled 
  });
}

/**
 * Hook specifically for user entity tabs
 */
export function useUserTabAccess(userId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'user', 
    entityId: userId, 
    enabled 
  });
}

/**
 * Hook specifically for EDLS sheet entity tabs
 */
export function useEdlsSheetTabAccess(sheetId: string | undefined, enabled = true) {
  return useTabAccess({ 
    entityType: 'edls_sheet', 
    entityId: sheetId, 
    enabled 
  });
}
