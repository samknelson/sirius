import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * One registered environment variable as the admin env endpoint describes it.
 *
 * Shared by every surface that renders a variable, so a second surface cannot
 * quietly disagree with the Environment Variables page about what the same
 * variable is.
 */
export interface EnvVarInfo {
  name: string;
  description: string;
  secret: boolean;
  category: string;
  required: boolean;
  isSet: boolean;
  source: "environment" | "override" | null;
  overridable: boolean;
  value: string | null;
  /**
   * Short digest of a secret's effective value — sent instead of the value,
   * and only for a secret that is set. Two installations holding the same
   * secret show the same fingerprint; it is not a value and cannot be used
   * as one.
   */
  valueFingerprint?: string;
  hasShadowedOverride: boolean;
  released: boolean;
  /**
   * When a change is picked up by the running app. null when the variable's
   * declaration does not state it — show nothing rather than implying
   * "immediate". "reload" means a subsystem on the Restart & Reload page can
   * re-read it in place, so no restart is needed.
   */
  changeTakesEffect: "immediate" | "restart" | "reload" | null;
}

/** The admin listing every surface reads variables from. */
export const ENV_VARIABLES_QUERY_KEY = ["/api/admin/env"];

export interface UseEnvVariablesOptions {
  /**
   * Anything else a caller has to re-read after a write. The variable list
   * itself is always refreshed; a caller that also renders something derived
   * from the stored value (e.g. what is waiting on a restart) says so here.
   */
  onWrite?: () => void;
}

export interface UseEnvVariablesResult {
  variables: EnvVarInfo[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /**
   * Store an override. Resolves true when it was stored — a caller closes its
   * editor on true and leaves the draft in place on false, so a refused value
   * is not silently discarded.
   */
  saveOverride: (name: string, value: string) => Promise<boolean>;
  /** Remove a stored override. Resolves true when it was removed. */
  clearOverride: (name: string) => Promise<boolean>;
  /** A save is in flight (for any variable read through this hook). */
  isSaving: boolean;
  /** A clear is in flight (for any variable read through this hook). */
  isClearing: boolean;
}

/**
 * Reading and writing environment variables, in one place.
 *
 * The write calls are the existing admin endpoints and nothing else: a caller
 * never assembles its own request for a variable, so "which variable may be
 * written, and what happens after" has a single answer.
 *
 * Mutations live here rather than in each row so that pending state is shared
 * exactly as it was when the Environment Variables page owned it — one write
 * in flight disables the write controls of every row rendered from the same
 * hook instance.
 */
export function useEnvVariables(
  options: UseEnvVariablesOptions = {},
): UseEnvVariablesResult {
  const { toast } = useToast();
  const { onWrite } = options;

  const { data, isLoading, isError } = useQuery<EnvVarInfo[]>({
    queryKey: ENV_VARIABLES_QUERY_KEY,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ENV_VARIABLES_QUERY_KEY });
    onWrite?.();
  };

  const setMutation = useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) =>
      apiRequest("PUT", `/api/admin/env/${encodeURIComponent(name)}`, { value }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Override saved" });
    },
    onError: (error) =>
      toast({
        title: "Failed to save override",
        description: getApiErrorMessage(error, "Request failed"),
        variant: "destructive",
      }),
  });

  const clearMutation = useMutation({
    mutationFn: async (name: string) =>
      apiRequest("DELETE", `/api/admin/env/${encodeURIComponent(name)}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Override cleared" });
    },
    onError: (error) =>
      toast({
        title: "Failed to clear override",
        description: getApiErrorMessage(error, "Request failed"),
        variant: "destructive",
      }),
  });

  return {
    variables: data,
    isLoading,
    isError,
    saveOverride: async (name, value) => {
      try {
        await setMutation.mutateAsync({ name, value });
        return true;
      } catch {
        // The refusal was already reported by onError; the caller only needs
        // to know not to treat the value as stored.
        return false;
      }
    },
    clearOverride: async (name) => {
      try {
        await clearMutation.mutateAsync(name);
        return true;
      } catch {
        return false;
      }
    },
    isSaving: setMutation.isPending,
    isClearing: clearMutation.isPending,
  };
}
