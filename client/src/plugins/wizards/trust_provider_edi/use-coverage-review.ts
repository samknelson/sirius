import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EdiCoverageConflict, EdiCoverageReview } from "@shared/edi-coverage-choices";

export function hasValidCoverageDecision(conflict: EdiCoverageConflict) {
  return !conflict.stale && !!conflict.decision &&
    conflict.decision.evidence === conflict.evidence &&
    conflict.candidates.some(candidate => candidate.id === conflict.decision?.selectedId && !candidate.familyIssue);
}

// A gateway's HTML is never a useful status or a confirmed job failure.
async function request<T>(url: string, input?: unknown): Promise<T> {
  const response = await fetch(url, input === undefined ? { credentials: "include" } : {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  let body: any;
  try { body = await response.json(); } catch {
    throw new Error("The server response is unavailable. Refresh status before taking action.");
  }
  if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : "Could not confirm this request. Refresh status.");
  return body as T;
}

type Progress = { status?: string; runId?: string; phase?: string; percentComplete?: number | null;
  processed?: number; total?: number; error?: string; heartbeatAt?: string };
type Action = { key: string; evidence: string; selectedId: string; reason: string } | { action: "complete" };

export function useCoverageReview(wizardId: string, autoStart = true) {
  const queryClient = useQueryClient();
  const dataUrl = `/api/wizards/${wizardId}/dispatch/coverage/data`;
  const wizardUrl = `/api/wizards/${wizardId}`;
  const wizard = useQuery<{ data?: { progress?: { run?: Progress; coverage?: Progress } } }>({
    queryKey: [wizardUrl], queryFn: () => request(wizardUrl),
    refetchOnMount: "always", refetchOnWindowFocus: "always",
    refetchInterval: 2000, refetchIntervalInBackground: true, retry: false,
  });
  const progress = wizard.data?.data?.progress?.coverage;
  const generating = wizard.data?.data?.progress?.run?.status === "in_progress";
  const running = generating || progress?.status === "in_progress";
  const unknown = (value?: Progress) => !!value &&
    ((!!value.status && !["in_progress", "completed", "failed"].includes(value.status)) ||
      (!!value.runId && !value.status));
  const statusUnavailable = wizard.isError || !wizard.data || unknown(progress) || unknown(wizard.data?.data?.progress?.run);
  const review = useQuery<EdiCoverageReview>({
    queryKey: [dataUrl, progress?.runId, progress?.status],
    queryFn: () => request(dataUrl),
    enabled: !statusUnavailable && !running,
    retry: false,
  });
  const reloadStatus = () => queryClient.invalidateQueries({ queryKey: [wizardUrl] });
  const start = useMutation({
    mutationFn: (input: Record<string, unknown>) => request(`/api/wizards/${wizardId}/dispatch/coverage/run`, input),
    onSettled: reloadStatus,
  });
  const attempted = useRef("");
  useEffect(() => {
    if (autoStart && !statusUnavailable && !running &&
        (!progress?.status || (progress.status === "completed" && (!review.data?.fingerprint || !review.data?.revision))) &&
        review.data?.applicable && attempted.current !== wizardId && !start.isPending) {
      attempted.current = wizardId;
      start.mutate({ action: "check" });
    }
  }, [autoStart, statusUnavailable, running, progress?.status, review.data?.applicable, wizardId, start.isPending]);
  const refresh = async () => {
    if (statusUnavailable || running) { await reloadStatus(); return; }
    start.mutate({ action: "check" });
  };
  const save = useMutation({
    mutationFn: (input: Action) => request<{ runId: string }>(`/api/wizards/${wizardId}/dispatch/coverage/run`,
      { ...input, action: "action" in input ? "complete" : "decision",
        fingerprint: review.data?.fingerprint, revision: review.data?.revision }),
    onSettled: reloadStatus,
  });
  return { review, save, refresh, running, generating, statusUnavailable, progress, start,
    ready: !statusUnavailable && !running &&
      (review.data?.applicable === false || (review.data?.ready === true && progress?.status === "completed")),
  };
}
