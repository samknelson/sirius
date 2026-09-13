import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";
import { resolveSmsVendor } from "../../../../services/comm/sms-vendor";

registerSystemStatusPlugin({
  id: "comm.sms",
  name: "SMS Provider",
  description: "Checks whether an SMS provider is configured and reachable.",
  async scan(): Promise<StatusMessage[]> {
    try {
      const vendor = await resolveSmsVendor();
      const { wcRequest } = await import("../../../../services/webclient");
      const result = await wcRequest({
        vendor: vendor.target,
        operation: "test-connection",
        args: undefined,
      });
      const connected = result.value?.connected ?? false;
      const failure =
        result.value?.error?.message ??
        result.error ??
        "SMS vendor did not answer";
      if (connected) {
        return [
          {
            priority: "info",
            title: `${vendor.pluginId} connected`,
            details: "SMS vendor passed its connection test.",
          },
        ];
      }
      return [
        {
          priority: "error",
          title: `${vendor.pluginId} connection test failed`,
          details: failure,
        },
      ];
    } catch (error) {
      return [
        {
          priority: "error",
          title: "SMS provider check failed",
          details: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  },
});
