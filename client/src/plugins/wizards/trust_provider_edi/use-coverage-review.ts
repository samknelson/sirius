import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { EdiCoverageConflict, EdiCoverageReview } from "@shared/edi-coverage-choices";

export function hasValidCoverageDecision(conflict: EdiCoverageConflict) {
  return !conflict.stale && !!conflict.decision &&
    conflict.decision.evidence === conflict.evidence &&
    conflict.candidates.some(candidate =>
      candidate.id === conflict.decision?.selectedId && !candidate.familyIssue);
}

export function useCoverageReview(wizardId: string) {
  const queryClient = useQueryClient();
  const dataUrl = `/api/wizards/${wizardId}/dispatch/coverage/data`;
  const wizardUrl = `/api/wizards/${wizardId}`;
  const wizard = useQuery<{ data?: { progress?: { run?: { status?: string } } } }>({
    queryKey: [wizardUrl],
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: query => query.state.data?.data?.progress?.run?.status === "in_progress" ? 2000 : false,
  });
  const review = useQuery<EdiCoverageReview>({
    queryKey: [dataUrl],
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [dataUrl] }),
      queryClient.invalidateQueries({ queryKey: [wizardUrl] }),
    ]);
  };
  const save = useMutation({
    mutationFn: (input: { key: string; evidence: string; selectedId: string; reason: string } | { action: "complete" }) =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/coverage/submit`, { input }),
    onSuccess: refresh,
    // Refresh rejected evidence too; never silently resubmit a stale choice.
    onError: refresh,
  });
  return {
    review, save, refresh,
    running: wizard.data?.data?.progress?.run?.status === "in_progress",
    statusUnavailable: wizard.isError || !wizard.data,
  };
}
