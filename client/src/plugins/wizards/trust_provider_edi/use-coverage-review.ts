import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EdiCoverageReview } from "@shared/edi-coverage-choices";

// A gateway's HTML is never a useful status or a confirmed job failure.
async function request<T>(url: string, input?: unknown): Promise<T> {
  const response = await fetch(url, input === undefined ? { credentials: "include", cache: "no-store" } : {
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

/** Saves one of the wizard's existing step exports; nothing is generated or sent. */
export async function downloadStepExport(wizardId: string, stepId: string, format: string) {
  const response = await fetch(`/api/wizards/${wizardId}/dispatch/${stepId}/export?format=${format}`,
    { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(problem?.message || "Could not prepare the download. Retry.");
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : /filename="([^"]+)"/i.exec(disposition)?.[1];
  if (!filename) throw new Error("The export did not include a filename");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Progress = { status?: string; runId?: string; phase?: string; percentComplete?: number | null;
  processed?: number; total?: number; error?: string | null; heartbeatAt?: string;
  startedAt?: string; failedAt?: string | null; completedAt?: string | null };

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
    mutationFn: (input: Record<string, unknown>) =>
      request<{ started: boolean; runId: string }>(`/api/wizards/${wizardId}/dispatch/coverage/run`, input),
    onSuccess: admitted => {
      // Only a confirmed admission replaces the saved failure. Do not leave
      // it displayed until the next poll, or optimistically clear it on click.
      queryClient.setQueryData<{ data?: { progress?: { run?: Progress; coverage?: Progress } } }>(
        [wizardUrl], old => old ? { ...old, data: { ...old.data, progress: {
          ...old.data?.progress, coverage: { status: "in_progress", runId: admitted.runId, phase: "Starting" },
        } } } : old);
    },
    onSettled: reloadStatus,
  });
  // Once per visit: a run with no check yet, or one whose saved check answers
  // for other settings, another rule, or the retired source picker.
  const attempted = useRef("");
  useEffect(() => {
    if (autoStart && !statusUnavailable && !running && progress?.status !== "failed" &&
        review.data?.applicable && !review.data.ready && !review.isFetching &&
        attempted.current !== wizardId && !start.isPending) {
      attempted.current = wizardId;
      start.mutate({ action: "check" });
    }
  }, [autoStart, statusUnavailable, running, progress?.status, review.data?.applicable, review.data?.ready,
    review.isFetching, wizardId, start.isPending]);
  const refresh = async () => {
    if (statusUnavailable || running) { await reloadStatus(); return; }
    start.mutate({ action: "check" });
  };
  // Binds to the list on screen: the server refuses if either value moved.
  const acknowledge = useMutation({
    mutationFn: () => request<{ runId: string }>(`/api/wizards/${wizardId}/dispatch/coverage/run`,
      { action: "acknowledge", revision: review.data?.revision, exclusionDigest: review.data?.exclusionDigest }),
    onSettled: reloadStatus,
  });
  const ready = !statusUnavailable && !running &&
    (review.data?.applicable === false || (review.data?.ready === true && progress?.status === "completed"));
  return { review, acknowledge, refresh, running, generating, statusUnavailable, statusLoading: wizard.isPending,
    progress, start, ready,
    /** The current list leaves records out and no administrator has accepted it. */
    needsAcknowledgement: ready && !!review.data?.applicable && (review.data.exclusionCount ?? 0) > 0 &&
      !review.data.acknowledgement,
  };
}
