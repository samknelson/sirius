import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";
import { serviceRegistry } from "../../../../services/service-registry";
import type { SmsTransport } from "../../../../services/comm/providers/sms";

registerSystemStatusPlugin({
  id: "comm.sms",
  name: "SMS Provider",
  description: "Checks whether an SMS provider is configured and reachable.",
  async scan(): Promise<StatusMessage[]> {
    const config = await serviceRegistry.getCategoryConfig("sms");
    const registered = serviceRegistry.getRegisteredProviders("sms");
    if (registered.length === 0 || !config.defaultProvider) {
      return [
        {
          priority: "notice",
          title: "No SMS provider configured",
          details:
            "No SMS provider is registered or selected. SMS features are unavailable until one is configured.",
        },
      ];
    }
    try {
      const provider = await serviceRegistry.resolve<SmsTransport>("sms");
      const test = await provider.testConnection();
      if (test.success) {
        return [
          {
            priority: "info",
            title: `${provider.displayName} connected`,
            details: test.message ?? `Provider '${provider.id}' passed its connection test.`,
          },
        ];
      }
      return [
        {
          priority: "error",
          title: `${provider.displayName} connection test failed`,
          details: test.error ?? test.message ?? "The provider's connection test did not succeed.",
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
