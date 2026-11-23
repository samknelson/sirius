/**
 * Opt-in freshness for current-state coordination views. These overrides are
 * explicit because ordinary application queries intentionally cache forever.
 * Hidden tabs stop polling and catch up immediately when the user returns.
 */
export const liveQueryOptions = {
  staleTime: 0,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnMount: "always",
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always",
} as const;
