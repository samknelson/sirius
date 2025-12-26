import { logger } from "../logger";
import { 
  TriggerType, 
  PluginContext, 
  LedgerTransaction,
  LedgerNotification,
} from "./types";
import { getEnabledChargePluginsByTrigger } from "./registry";
import { storage } from "../storage";

export interface PluginExecutionSummary {
  pluginId: string;
  success: boolean;
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

  // Get all enabled plugins that handle this trigger (filters by component status)
  const applicablePlugins = await getEnabledChargePluginsByTrigger(trigger);
  
  if (applicablePlugins.length === 0) {
    logger.debug("No plugins registered for trigger", {
      service: "charge-plugin-executor",
      trigger,
    });
    return {
      executed: [],
      totalTransactions: [],
      notifications: [],
    };
  }

  // Get employerId from context if available (for employer-scoped plugins)
  let employerId: string | null = null;
  if ('employerId' in context) {
    employerId = context.employerId;
  }

  const executed: PluginExecutionSummary[] = [];
  const totalTransactions: LedgerTransaction[] = [];
  const notifications: LedgerNotification[] = [];

  // Execute each plugin
  for (const plugin of applicablePlugins) {
    try {
      // Get configs for this plugin (both global and employer-specific if applicable)
      const configs = await getEnabledConfigsForPlugin(plugin.metadata.id, employerId);
      
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

      // Create ledger entry
      await storage.ledger.entries.create({
        chargePlugin: transaction.chargePlugin,
        chargePluginKey: transaction.chargePluginKey,
        chargePluginConfigId: transaction.chargePluginConfigId,
        amount: transaction.amount,
        eaId: ea.id,
        referenceType: transaction.referenceType || "charge_plugin",
        referenceId: transaction.referenceId,
        date: transaction.transactionDate,
        memo: transaction.description,
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
 * Get enabled configs for a plugin (global or employer-specific)
 */
async function getEnabledConfigsForPlugin(
  pluginId: string,
  employerId: string | null
): Promise<any[]> {
  return storage.chargePluginConfigs.getEnabledForPlugin(pluginId, employerId);
}
