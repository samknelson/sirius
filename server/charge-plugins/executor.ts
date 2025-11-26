import { db } from "../db";
import { chargePluginConfigs, ledgerEa, ledger } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import { 
  TriggerType, 
  PluginContext, 
  LedgerTransaction,
} from "./types";
import { getChargePluginsByTrigger } from "./registry";
import { storage } from "../storage/database";

export interface PluginExecutionSummary {
  pluginId: string;
  success: boolean;
  transactionCount: number;
  message?: string;
  error?: string;
}

export interface ChargePluginExecutionResult {
  executed: PluginExecutionSummary[];
  totalTransactions: LedgerTransaction[];
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

  // Get all plugins that handle this trigger
  const applicablePlugins = getChargePluginsByTrigger(trigger);
  
  if (applicablePlugins.length === 0) {
    logger.debug("No plugins registered for trigger", {
      service: "charge-plugin-executor",
      trigger,
    });
    return {
      executed: [],
      totalTransactions: [],
    };
  }

  // Get employerId from context if available (for employer-scoped plugins)
  let employerId: string | null = null;
  if ('employerId' in context) {
    employerId = context.employerId;
  }

  const executed: PluginExecutionSummary[] = [];
  const totalTransactions: LedgerTransaction[] = [];

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
          message: result.message,
          error: result.error,
        });

        if (result.success && result.transactions.length > 0) {
          totalTransactions.push(...result.transactions);
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
  });

  return {
    executed,
    totalTransactions,
  };
}

/**
 * Create ledger entries for transactions
 */
async function createLedgerEntries(transactions: LedgerTransaction[]): Promise<void> {
  for (const transaction of transactions) {
    try {
      // Find or create EA entry for this entity-account pair using a transaction to handle race conditions
      const eaId = await db.transaction(async (tx) => {
        // First, try to find existing EA entry
        const [existingEa] = await tx
          .select()
          .from(ledgerEa)
          .where(
            and(
              eq(ledgerEa.accountId, transaction.accountId),
              eq(ledgerEa.entityType, transaction.entityType),
              eq(ledgerEa.entityId, transaction.entityId)
            )
          )
          .limit(1);

        if (existingEa) {
          return existingEa.id;
        }

        // Try to create new EA entry with conflict handling
        const insertResult = await tx
          .insert(ledgerEa)
          .values({
            accountId: transaction.accountId,
            entityType: transaction.entityType,
            entityId: transaction.entityId,
          })
          .onConflictDoNothing()
          .returning();

        if (insertResult.length > 0) {
          logger.info("Created new ledger EA entry", {
            service: "charge-plugin-executor",
            eaId: insertResult[0].id,
            accountId: transaction.accountId,
            entityType: transaction.entityType,
            entityId: transaction.entityId,
          });
          return insertResult[0].id;
        }

        // Conflict occurred, look up the existing entry
        const [conflictedEa] = await tx
          .select()
          .from(ledgerEa)
          .where(
            and(
              eq(ledgerEa.accountId, transaction.accountId),
              eq(ledgerEa.entityType, transaction.entityType),
              eq(ledgerEa.entityId, transaction.entityId)
            )
          )
          .limit(1);

        if (!conflictedEa) {
          throw new Error("Failed to find or create EA entry after conflict");
        }

        return conflictedEa.id;
      });

      // Create ledger entry (outside the EA transaction)
      await storage.ledger.entries.create({
        amount: transaction.amount,
        eaId,
        referenceType: transaction.referenceType || "charge_plugin",
        referenceId: transaction.referenceId,
        date: transaction.transactionDate,
        memo: transaction.description,
        data: transaction.metadata,
      });

      logger.info("Created ledger entry from charge plugin", {
        service: "charge-plugin-executor",
        eaId,
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
  const conditions = [
    eq(chargePluginConfigs.pluginId, pluginId),
    eq(chargePluginConfigs.enabled, true),
  ];

  // Get global config
  const globalConfig = await db
    .select()
    .from(chargePluginConfigs)
    .where(
      and(
        ...conditions,
        eq(chargePluginConfigs.scope, "global")
      )
    )
    .limit(1);

  // If employer-specific, also get employer config (which overrides global)
  if (employerId) {
    const employerConfig = await db
      .select()
      .from(chargePluginConfigs)
      .where(
        and(
          ...conditions,
          eq(chargePluginConfigs.scope, "employer"),
          eq(chargePluginConfigs.employerId, employerId)
        )
      )
      .limit(1);

    // Return employer config if exists, otherwise global
    if (employerConfig.length > 0) {
      return employerConfig;
    }
  }

  return globalConfig;
}
