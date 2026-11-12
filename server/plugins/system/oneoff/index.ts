import { z } from "zod";
import { logger } from "../../../logger";
import {
  baseConfigSchemaShape,
  baseSearchSchemaShape,
  registerPluginConfigAdapter,
  registerPluginKind,
} from "../../_core";
import { oneoffPluginRegistry } from "./registry";

export * from "./types";
export {
  oneoffPluginRegistry,
  getOneoffPlugin,
  registerOneoffPlugin,
} from "./registry";

let kindRegistered = false;

function registerOneoffKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "oneoff",
    registry: oneoffPluginRegistry,
    label: "Oneoff Actions",
    description: "Administrator-triggered one-time database operations.",
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
  });
  registerPluginConfigAdapter({
    pluginKind: "oneoff",
    configSchema: z.object(baseConfigSchemaShape),
    searchParamsSchema: z.object(baseSearchSchemaShape),
    toRows: (input) => ({
      base: {
        pluginKind: "oneoff",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
    }),
    seedDefault: (plugin) => {
      const p = plugin as { metadata: { id: string; name: string; singleton?: boolean } };
      if (!p.metadata.singleton || p.metadata.id !== "oneoff-test") return null;
      return {
        pluginId: p.metadata.id,
        name: p.metadata.name,
        enabled: false,
        ordering: 0,
        data: {},
      };
    },
  });
  kindRegistered = true;
}

export function initializeOneoffPluginSystem(): void {
  registerOneoffKind();
  logger.info("Oneoff plugins registered", {
    service: "oneoff-plugins",
    plugins: oneoffPluginRegistry.listIds(),
  });
}

import "./plugins/test";