import { z } from "zod";
import type { BasePluginMetadata } from "../../_core/types";
import type { FloodContext } from "../../../flood/types";
import type { JsonSchema } from "@shared/json-schema-form";
import type { PluginValidationResult } from "../../_core/kinds";

export const floodSettingsSchema = z.object({
  threshold: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
});
export type FloodSettings = z.infer<typeof floodSettingsSchema>;

export interface FloodPlugin extends BasePluginMetadata {
  singleton: boolean;
  defaults: Readonly<FloodSettings>;
  getIdentifier(context: FloodContext, data?: unknown): string;
  resolveIdentifierName?(identifier: string): Promise<string | null>;
  configSchema?(): JsonSchema;
  uiSchema?(): Record<string, unknown>;
  validateConfig?(data: unknown): Promise<PluginValidationResult>;
  /** Instance-based plugins opt into matching; singleton callers keep their explicit seam. */
  matches?(data: unknown, context: FloodContext): boolean;
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
