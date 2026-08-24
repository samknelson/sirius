import { z } from "zod";
import type { JsonSchema } from "@shared/json-schema-form";
import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

const retentionPolicySchema = z.object({
  module: z.string().nullable().default(null),
  operation: z.string().nullable().default(null),
  retentionDays: z.number().int().min(1).max(3650),
  enabled: z.boolean().default(false),
});

const settingsSchema = z.object({
  policies: z.array(retentionPolicySchema).default([]),
});

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export type LogCleanupSettings = z.infer<typeof settingsSchema>;

/**
 * Pre-seeded retention policies shipped with the plugin.
 * All policies start with `enabled: false` — an admin must explicitly enable
 * each one after turning on the log-cleanup cron job (which is also disabled by
 * default under Config → Cron Jobs).
 *
 * saml_debug: captures full SAML assertion payloads written when the "debug"
 * component is enabled. Kept short (7 days) because entries include raw
 * SAMLResponse XML and full IdP attribute payloads.
 */
const DEFAULT_SETTINGS: LogCleanupSettings = {
  policies: [
    {
      module: "saml_debug",
      operation: null,
      retentionDays: 7,
      enabled: false,
    },
  ],
};

/**
 * Each policy purges log rows older than `retentionDays` for one
 * module/operation combination. Leave `module`/`operation` blank to match all.
 * Only policies with `enabled` checked run. Rendered by the generic admin Edit
 * modal via the default RJSF array editor (boolean → checkbox).
 */
const configSchema: JsonSchema = {
  type: "object",
  properties: {
    policies: {
      type: "array",
      title: "Retention Policies",
      description:
        "Purge log entries older than the retention period for each module/operation. Leave module/operation blank to match all.",
      default: [],
      items: {
        type: "object",
        required: ["retentionDays"],
        properties: {
          module: {
            type: ["string", "null"],
            title: "Module",
            default: null,
          },
          operation: {
            type: ["string", "null"],
            title: "Operation",
            default: null,
          },
          retentionDays: {
            type: "integer",
            title: "Retention Days",
            minimum: 1,
            maximum: 3650,
          },
          enabled: {
            type: "boolean",
            title: "Enabled",
            default: false,
          },
        },
      },
    },
  },
};

registerCronPlugin({
  metadata: {
    id: 'log-cleanup',
    name: 'Log Cleanup',
    description: 'Purges log entries based on configurable retention policies per module/operation combination',
    singleton: true,
  },
  defaultSchedule: '0 3 * * *', // Daily at 3 AM
  defaultEnabled: false,

  settingsSchema,
  configSchema,

  getDefaultSettings: () => DEFAULT_SETTINGS,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const settings = settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...context.settings,
    });

    const enabledPolicies = settings.policies.filter(p => p.enabled);

    if (enabledPolicies.length === 0) {
      return {
        message: 'No enabled retention policies configured',
        metadata: { policiesChecked: 0, totalDeleted: 0 },
      };
    }

    const results: Array<{
      module: string | null;
      operation: string | null;
      retentionDays: number;
      count: number;
    }> = [];

    let totalDeleted = 0;

    for (const policy of enabledPolicies) {
      if (context.mode === 'test') {
        const count = await storage.logs.countByModuleOperationOlderThan(
          policy.module,
          policy.operation,
          policy.retentionDays
        );

        results.push({
          module: policy.module,
          operation: policy.operation,
          retentionDays: policy.retentionDays,
          count,
        });
        totalDeleted += count;
      } else {
        const result = await storage.logs.purgeByModuleOperation(
          policy.module,
          policy.operation,
          policy.retentionDays
        );

        totalDeleted += result.deleted;

        results.push({
          module: policy.module,
          operation: policy.operation,
          retentionDays: policy.retentionDays,
          count: result.deleted,
        });
      }
    }

    const verb = context.mode === 'test' ? 'Would delete' : 'Deleted';

    return {
      message: `${verb} ${totalDeleted} log entries across ${enabledPolicies.length} policies`,
      metadata: {
        policiesChecked: enabledPolicies.length,
        totalDeleted,
        details: results,
      },
    };
  },
});
