import { logger } from "../../../logger";
import { 
  TriggerType, 
  PluginContext, 
  LedgerTransaction,
  LedgerNotification,
} from "./types";
import { getEnabledChargePluginsByTrigger, getChargePlugin, isChargePluginEnabled } from "./registry";
import { mergeEnabledChargeConfigs, toChargeConfig } from "./charge-config-resolution";
import { storage } from "../../../storage";
import { dateToYmd } from "@shared/utils/date";

export interface PluginExecutionSummary {
  pluginId: string;
  success: boolean;
  skippedDuplicate?: boolean;
  transactionCount: number;
  notificationCount: number;
  message?: string;
  error?: string;
}

export interface ChargePluginExecutionResult {
  executed: PluginExecutionSummary[];
  totalTransactions: LedgerTransaction[];
  notifications: LedgerNotification[];
}

/**
 * Execute all enabled charge plugins for a given trigger and context
 */
export async function executeChargePlugins(
  context: PluginContext
): Promise<ChargePluginExecutionResult> {
  const trigger = context.trigger;
  
  logger.info("Executing charge plugins", {
    service: "charge-plugin-executor",
    trigger,
  });

  const employerId = "employerId" in context ? context.employerId : null;
  const configsByPlugin = await getEnabledConfigs(employerId);
  const executed: PluginExecutionSummary[] = [];
  for (const pluginId of configsByPlugin.keys()) {
    const plugin = getChargePlugin(pluginId);
    if (plugin && !plugin.canHandle(trigger)) continue;
    if (plugin && await isChargePluginEnabled(pluginId)) continue;
    const error = `Configured charge plugin "${pluginId}" is unavailable`;
    logger.error(error, { service: "charge-plugin-executor", pluginId, trigger });
    executed.push({ pluginId, success: false, transactionCount: 0, notificationCount: 0, error });
  }
  // Unavailable configurations remain failed results, not successful omissions.
  const applicablePlugins = await getEnabledChargePluginsByTrigger(trigger);
  
  if (applicablePlugins.length === 0) {
    logger.debug("No plugins registered for trigger", {
      service: "charge-plugin-executor",
      trigger,
    });
    return {
      executed,
      totalTransactions: [],
      notifications: [],
    };
  }

  const totalTransactions: LedgerTransaction[] = [];
  const notifications: LedgerNotification[] = [];

  // Execute each plugin
  for (const plugin of applicablePlugins) {
    try {
      // Get configs for this plugin (both global and employer-specific if applicable)
      const configs = configsByPlugin.get(plugin.metadata.id) ?? [];
      
      if (configs.length === 0) {
        logger.debug("No enabled configs for plugin", {
          service: "charge-plugin-executor",
          pluginId: plugin.metadata.id,
          trigger,
        });
        continue;
      }

      // Execute plugin for each config (usually just one, but could be multiple)
      for (const config of configs) {
        logger.info("Executing charge plugin", {
          service: "charge-plugin-executor",
          pluginId: plugin.metadata.id,
          configId: config.id,
          scope: config.scope,
        });

        const result = await plugin.execute(context, config);
        
        executed.push({
          pluginId: plugin.metadata.id,
          success: result.success,
          skippedDuplicate: result.skippedDuplicate,
          transactionCount: result.transactions.length,
          notificationCount: result.notifications?.length || 0,
          message: result.message,
          error: result.error,
        });

        if (result.success && result.transactions.length > 0) {
          totalTransactions.push(...result.transactions);
        }

        if (result.success && result.notifications && result.notifications.length > 0) {
          notifications.push(...result.notifications);
        }
      }
    } catch (error) {
      logger.error("Failed to execute charge plugin", {
        service: "charge-plugin-executor",
        pluginId: plugin.metadata.id,
        error: error instanceof Error ? error.message : String(error),
      });
      
      executed.push({
        pluginId: plugin.metadata.id,
        success: false,
        transactionCount: 0,
        notificationCount: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Create ledger entries for all transactions (soft-fail - don't throw on error)
  if (totalTransactions.length > 0) {
    logger.info("About to create ledger entries for transactions", {
      service: "charge-plugin-executor",
      transactionCount: totalTransactions.length,
      transactions: totalTransactions.map(t => ({
        chargePlugin: t.chargePlugin,
        entityType: t.entityType,
        entityId: t.entityId,
        accountId: t.accountId,
        amount: t.amount,
      })),
    });
    try {
      await createLedgerEntries(totalTransactions);
      logger.info("Completed ledger entry creation for charge plugin transactions", {
        service: "charge-plugin-executor",
        count: totalTransactions.length,
      });
    } catch (error) {
      // Log error but don't throw - plugin failures should not block core functionality
      logger.error("Error during ledger entry creation for charge plugin transactions", {
        service: "charge-plugin-executor",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  logger.info("Charge plugin execution completed", {
    service: "charge-plugin-executor",
    trigger,
    executedCount: executed.length,
    totalTransactions: totalTransactions.length,
    notificationsCount: notifications.length,
  });

  return {
    executed,
    totalTransactions,
    notifications,
  };
}

/**
 * Create ledger entries for transactions
 */
async function createLedgerEntries(transactions: LedgerTransaction[]): Promise<void> {
  for (const transaction of transactions) {
    try {
      // Find or create EA entry for this entity-account pair using storage layer
      const ea = await storage.ledger.ea.getOrCreate(
        transaction.entityType,
        transaction.entityId,
        transaction.accountId
      );

      await storage.ledger.entries.create({
        chargePlugin: transaction.chargePlugin,
        chargePluginKey: transaction.chargePluginKey,
        chargePluginConfigId: transaction.chargePluginConfigId,
        amount: transaction.amount,
        eaId: ea.id,
        referenceType: transaction.referenceType || "charge_plugin",
        referenceId: transaction.referenceId,
        statementYmd: transaction.statementYmd || dateToYmd(transaction.transactionDate),
        memo: transaction.memo !== undefined ? transaction.memo : transaction.description,
        data: transaction.metadata,
      });

      logger.info("Created ledger entry from charge plugin", {
        service: "charge-plugin-executor",
        eaId: ea.id,
        amount: transaction.amount,
        description: transaction.description,
      });

    } catch (error) {
      // Log error but don't throw - we want to continue processing other transactions
      logger.error("Failed to create ledger entry", {
        service: "charge-plugin-executor",
        transaction,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - just log and continue
    }
  }
}

/**
 * Load scoped configs once, preserving per-plugin employer/account overrides.
 */
async function getEnabledConfigs(
  employerId: string | null
): Promise<Map<string, ReturnType<typeof toChargeConfig>[]>> {
  // All enabled global configs (one per account).
  const globalConfigs = (
    await storage.pluginConfigs.search("charge", {
      enabled: true,
      scope: "global",
    })
  ).map(toChargeConfig);

  // Employer-specific configs override globals targeting the same account.
  const employerConfigs = employerId ? (
    await storage.pluginConfigs.search("charge", {
      enabled: true,
      scope: "employer",
      employerId,
    })
  ).map(toChargeConfig) : [];

  return new Map([...new Set([...globalConfigs, ...employerConfigs].map(config => config.pluginId))]
    .map(pluginId => [pluginId, mergeEnabledChargeConfigs(
      globalConfigs.filter(config => config.pluginId === pluginId),
      employerConfigs.filter(config => config.pluginId === pluginId),
    )]));
}
