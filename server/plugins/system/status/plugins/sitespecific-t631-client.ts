import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";

const REQUIRED_ENV_VARS = [
  "SITESPECIFIC_T631_CLIENT_URL",
  "SITESPECIFIC_T631_CLIENT_ACCOUNT_ID",
  "SITESPECIFIC_T631_CLIENT_ACCESS_TOKEN",
  "SITESPECIFIC_T631_CLIENT_EMPLOYER_ID",
  "SITESPECIFIC_T631_CLIENT_EMPLOYER_TOKEN",
] as const;

/**
 * Status plugin contributed by the sitespecific.t631.client component:
 * hidden entirely when the component is disabled (framework component
 * gating), notice when the client is unconfigured, error when the remote
 * service ping fails.
 */
registerSystemStatusPlugin({
  id: "sitespecific.t631.client",
  name: "T631 Client",
  description: "Connection status of the remote T631 service.",
  requiredComponent: "sitespecific.t631.client",
  async scan(): Promise<StatusMessage[]> {
    const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      return [
        {
          priority: "notice",
          title: "T631 client not configured",
          details: `Missing environment variables: ${missing.join(", ")}.`,
        },
      ];
    }
    const host = (() => {
      try {
        return new URL(process.env.SITESPECIFIC_T631_CLIENT_URL!).hostname;
      } catch {
        return "(invalid URL)";
      }
    })();
    try {
      const { t631Fetch } = await import(
        "../../../../modules/sitespecific/t631/client/fetch"
      );
      const result = await t631Fetch("sirius_service_ping");
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
      return [
        {
          priority: "error",
          title: "T631 service ping failed",
          details: `Ping to ${host} threw — ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }
  },
});
