import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";
import { isMaintenanceModeError } from "../../../../services/maintenance-flag";

/**
 * Status plugin contributed by the sitespecific.t631.client component:
 * hidden entirely when the component is disabled (framework component
 * gating), notice when the connection is unusable, error when the remote
 * service ping fails.
 *
 * The five environment variables this used to re-read per scan are gone from
 * here. The connection is a configuration row now, and asking for it is
 * `t631Fetch`'s job — which also means "unconfigured" is reported in whatever
 * words actually apply (no connection, two of them, a credential that is
 * missing or malformed) instead of a list of variable names that may no longer
 * be the reason.
 */
registerSystemStatusPlugin({
  id: "sitespecific.t631.client",
  name: "T631 Client",
  description: "Connection status of the remote T631 service.",
  requiredComponent: "sitespecific.t631.client",
  async scan(): Promise<StatusMessage[]> {
    const { t631Fetch, isT631ConfigurationError } = await import(
      "../../../../modules/sitespecific/t631/client/fetch"
    );

    const hostOf = (url: string): string => {
      try {
        return new URL(url).hostname;
      } catch {
        return "(invalid URL)";
      }
    };

    try {
      const result = await t631Fetch("sirius_service_ping");
      const host = hostOf(result.request.url);
      if (result.success) {
        return [
          {
            priority: "info",
            title: "T631 service reachable",
            details: `Ping to ${host} succeeded in ${result.durationMs}ms.`,
          },
        ];
      }
      return [
        {
          priority: "error",
          title: "T631 service ping failed",
          details: `Ping to ${host} failed${result.response ? ` (HTTP ${result.response.status})` : ""}${result.error ? ` — ${result.error}` : ""}.`,
        },
      ];
    } catch (error) {
      // A maintenance refusal is not a broken remote service: nothing was
      // asked. Reported as the refusal it is, in the guard's own words.
      if (isMaintenanceModeError(error)) {
        return [
          {
            priority: "notice",
            title: "T631 service not contacted",
            details: error.message,
          },
        ];
      }
      // Neither is an unusable connection. Nothing was asked there either, and
      // calling it a ping failure would send an operator to look at a remote
      // system that is very probably fine.
      if (isT631ConfigurationError(error)) {
        return [
          {
            priority: "notice",
            title: "T631 client not configured",
            details: error.message,
          },
        ];
      }
      return [
        {
          priority: "error",
          title: "T631 service ping failed",
          details: `Ping threw — ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }
  },
});
