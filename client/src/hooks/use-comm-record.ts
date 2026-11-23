import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";
import type { CommWithDetails } from "@/lib/comm-types";

/** All standalone and popup reads share the same audience-scoped record. */
export function useCommRecord(commId: string, viewerKey: string, enabled = true) {
  return useQuery<CommWithDetails>({
    queryKey: ["/api/comm", commId, { viewerKey }],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/comm/${commId}`, {
        credentials: "include", cache: "no-store", signal,
      });
      if (!response.ok) throw new ApiError(response.status, "Failed to fetch communication");
      return response.json();
    },
    enabled: enabled && !!commId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
