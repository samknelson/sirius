import { z } from "zod";
import { storage } from "../../storage";
import type { CronJobHandler, CronJobContext, CronJobResult, CronJobSettingsAdapter } from "../registry";

const retentionPolicySchema = z.object({
  module: z.string().nullable(),
  operation: z.string().nullable(),
  retentionDays: z.number().int().min(1).max(3650),
  enabled: z.boolean(),
});

const settingsSchema = z.object({
  policies: z.array(retentionPolicySchema).default([]),
});

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export type LogCleanupSettings = z.infer<typeof settingsSchema>;

const DEFAULT_SETTINGS: LogCleanupSettings = {
  policies: [],
};

const logCleanupSettingsAdapter: CronJobSettingsAdapter = {
  componentId: 'logCleanupPolicies',

  async loadClientState(currentSettings: Record<string, unknown>) {
    const stats = await storage.logs.getModuleOperationStats();
    const parsed = settingsSchema.safeParse(currentSettings);
    const policies = parsed.success ? parsed.data.policies : [];

    const policyMap = new Map<string, RetentionPolicy>();
    for (const policy of policies) {
      const key = `${policy.module ?? ''}::${policy.operation ?? ''}`;
      policyMap.set(key, policy);
    }

    const mergedRows = stats.map(stat => {
      const key = `${stat.module ?? ''}::${stat.operation ?? ''}`;
      const existing = policyMap.get(key);
      return {
        module: stat.module,
        operation: stat.operation,
        count: stat.count,
        retentionDays: existing?.retentionDays ?? null,
        enabled: existing?.enabled ?? false,
      };
    });

    for (const policy of policies) {
      const key = `${policy.module ?? ''}::${policy.operation ?? ''}`;
      const hasStats = stats.some(s => 
        `${s.module ?? ''}::${s.operation ?? ''}` === key
      );
      if (!hasStats) {
        mergedRows.push({
          module: policy.module,
          operation: policy.operation,
          count: 0,
          retentionDays: policy.retentionDays,
          enabled: policy.enabled,
        });
      }
    }

    return {
      clientState: { rows: mergedRows },
      values: { policies },
    };
  },

  async applyUpdate(data: unknown) {
    const validated = settingsSchema.parse(data);
    return validated;
  },
};

export const logCleanupHandler: CronJobHandler = {
  description: 'Purges log entries based on configurable retention policies per module/operation combination',

  settingsSchema,

  getDefaultSettings: () => DEFAULT_SETTINGS,

  settingsAdapter: logCleanupSettingsAdapter,

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
};
