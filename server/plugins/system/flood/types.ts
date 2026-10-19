import { z } from "zod";
import type { BasePluginMetadata } from "../../_core/types";
import type { FloodContext } from "../../../flood/types";

export const floodSettingsSchema = z.object({
  threshold: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
});
export type FloodSettings = z.infer<typeof floodSettingsSchema>;

export interface FloodPlugin extends BasePluginMetadata {
  singleton: true;
  defaults: Readonly<FloodSettings>;
  getIdentifier(context: FloodContext): string;
  resolveIdentifierName?(identifier: string): Promise<string | null>;
}

export function floodConfigSchema(plugin: FloodPlugin) {
  return {
    type: "object" as const,
    required: ["threshold", "windowSeconds"],
    additionalProperties: false,
    properties: {
      threshold: {
        type: "integer" as const, minimum: 1, title: "Threshold",
        default: plugin.defaults.threshold,
        description: `Maximum events per window. Code default: ${plugin.defaults.threshold}.`,
      },
      windowSeconds: {
        type: "integer" as const, minimum: 1, title: "Window (seconds)",
        default: plugin.defaults.windowSeconds,
        description: `Counting window in seconds. Code default: ${plugin.defaults.windowSeconds}.`,
      },
    },
  };
}
