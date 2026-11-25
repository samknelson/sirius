import type { ComponentStartup } from "../../../server/services/component-startup-types";
import "./bearer-auth";
import { storage } from "../../../server/storage";
import { runOrDeferStartupOperation } from "../../../server/services/startup-deferrals";

export const start: NonNullable<ComponentStartup["start"]> = async () => {
  // Core client settings only: also upgrade when this component is disabled,
  // so later removal of its directory still preserves the authentication choice.
  await runOrDeferStartupOperation("freeman-bearer-selection-upgrade", async () => {
    for (const client of await storage.wsClients.getAll()) {
      const data = client.data ?? {};
      if (Object.hasOwn(data, "authenticationProvider")) continue;
      const configId = data.freemanBearerAuthorizationConfigId;
      if (typeof configId === "string" && configId.trim()) {
        await storage.wsClients.updateAuthenticationSelection(client.id, data, {
          provider: "freeman-bearer", configId: configId.trim(),
        });
      }
    }
  });
};
