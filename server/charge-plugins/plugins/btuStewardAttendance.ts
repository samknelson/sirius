import { ChargePlugin } from "../base";
import { 
  TriggerType, 
  PluginContext, 
  PluginExecutionResult, 
  ParticipantSavedContext,
  LedgerTransaction,
  LedgerNotification,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import { z } from "zod";
import { logger } from "../../logger";
import { storage } from "../../storage/database";
import type { Ledger, ChargePluginConfig } from "@shared/schema";

const btuStewardAttendanceSettingsSchema = z.object({
  accountId: z.string().uuid("Account ID must be a valid UUID"),
  amount: z.number().positive("Amount must be positive"),
  eventTypeIds: z.array(z.string().uuid()).min(1, "At least one event type must be selected"),
  attendedStatuses: z.array(z.string()).min(1, "At least one attended status must be selected"),
});

type BtuStewardAttendanceSettings = z.infer<typeof btuStewardAttendanceSettingsSchema>;

interface ExpectedEntry {
  chargePluginKey: string;
  amount: string;
  description: string;
  transactionDate: Date;
  eaId: string;
  referenceType: string;
  referenceId: string;
  metadata: Record<string, any>;
}

class BtuStewardAttendancePlugin extends ChargePlugin {
  readonly metadata = {
    id: "btu-steward-attendance",
    name: "BTU Steward Attendance",
    description: "Awards points to stewards who attend configured event types with an 'attended' status.",
    triggers: [TriggerType.PARTICIPANT_SAVED],
    defaultScope: "global" as const,
    settingsSchema: btuStewardAttendanceSettingsSchema,
    requiredComponent: "sitespecific.btu",
  };

  private async computeExpectedEntry(
    context: ParticipantSavedContext,
    config: any,
    settings: BtuStewardAttendanceSettings
  ): Promise<ExpectedEntry | null> {
    if (!settings.eventTypeIds.includes(context.eventTypeId)) {
      return null;
    }

    if (!context.workerId) {
      return null;
    }

    if (!context.isSteward) {
      return null;
    }

    if (!context.status || !settings.attendedStatuses.includes(context.status)) {
      return null;
    }

    const ea = await storage.ledger.ea.getOrCreate(
      "worker",
      context.workerId,
      settings.accountId
    );

    const chargePluginKey = `${config.id}:${context.participantId}`;
    
    const event = await storage.events.get(context.eventId);
    const eventTitle = event?.title || "Event";
    const description = `Steward Attendance - ${eventTitle}`;

    const participant = await storage.eventParticipants.get(context.participantId);
    const transactionDate = participant?.registeredAt 
      ? new Date(participant.registeredAt) 
      : new Date();

    // Negate amount to create a credit (award) in the ledger
    // Positive in ledger = charge, negative = credit (award)
    return {
      chargePluginKey,
      amount: (-settings.amount).toFixed(2),
      description,
      transactionDate,
      eaId: ea.id,
      referenceType: "participant",
      referenceId: context.participantId,
      metadata: {
        pluginId: this.metadata.id,
        pluginConfigId: config.id,
        participantId: context.participantId,
        eventId: context.eventId,
        eventTypeId: context.eventTypeId,
        workerId: context.workerId,
        contactId: context.contactId,
        status: context.status,
      },
    };
  }

  async execute(
    context: PluginContext,
    config: any
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.PARTICIPANT_SAVED) {
      return {
        success: false,
        transactions: [],
        error: `BTU Steward Attendance plugin only handles PARTICIPANT_SAVED trigger, got ${context.trigger}`,
      };
    }

    const participantContext = context as ParticipantSavedContext;

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        logger.error("Invalid settings for BTU Steward Attendance plugin", {
          service: "charge-plugin-btu-steward-attendance",
          errors: validationResult.errors,
          configId: config.id,
        });
        return {
          success: false,
          transactions: [],
          error: `Invalid plugin settings: ${validationResult.errors?.join(", ")}`,
        };
      }

      const settings = config.settings as BtuStewardAttendanceSettings;

      if (!settings.eventTypeIds.includes(participantContext.eventTypeId)) {
        logger.debug("Event type does not match configured types, skipping", {
          service: "charge-plugin-btu-steward-attendance",
          participantId: participantContext.participantId,
          eventTypeId: participantContext.eventTypeId,
          configuredEventTypes: settings.eventTypeIds,
        });
        return {
          success: true,
          transactions: [],
          message: "Event type does not match configured types",
        };
      }

      const chargePluginKey = `${config.id}:${participantContext.participantId}`;

      const expectedEntry = await this.computeExpectedEntry(participantContext, config, settings);

      const existingEntry = await storage.ledger.entries.getByChargePluginKey(
        this.metadata.id,
        chargePluginKey
      );

      if (!expectedEntry && !existingEntry) {
        logger.debug("No entry expected and none exists, nothing to do", {
          service: "charge-plugin-btu-steward-attendance",
          participantId: participantContext.participantId,
        });
        return {
          success: true,
          transactions: [],
          message: "No charge applicable (not a steward or not attended)",
        };
      }

      if (!expectedEntry && existingEntry) {
        await storage.ledger.entries.deleteByChargePluginKey(
          this.metadata.id,
          chargePluginKey
        );
        
        logger.info("Deleted ledger entry - participant no longer qualifies", {
          service: "charge-plugin-btu-steward-attendance",
          participantId: participantContext.participantId,
          deletedEntryId: existingEntry.id,
          previousAmount: existingEntry.amount,
        });

        const notification: LedgerNotification = {
          type: "deleted",
          amount: existingEntry.amount,
          description: `Steward attendance points removed: -${existingEntry.amount}`,
        };

        return {
          success: true,
          transactions: [],
          notifications: [notification],
          message: "Deleted ledger entry - participant no longer qualifies",
        };
      }

      if (expectedEntry && !existingEntry) {
        const transaction: LedgerTransaction = {
          chargePlugin: this.metadata.id,
          chargePluginKey: expectedEntry.chargePluginKey,
          chargePluginConfigId: config.id,
          accountId: settings.accountId,
          entityType: "worker",
          entityId: participantContext.workerId!,
          amount: expectedEntry.amount,
          description: expectedEntry.description,
          transactionDate: expectedEntry.transactionDate,
          referenceType: expectedEntry.referenceType,
          referenceId: expectedEntry.referenceId,
          metadata: expectedEntry.metadata,
        };

        logger.info("Creating steward attendance points entry", {
          service: "charge-plugin-btu-steward-attendance",
          participantId: participantContext.participantId,
          amount: expectedEntry.amount,
          workerId: participantContext.workerId,
          eventId: participantContext.eventId,
        });

        const notification: LedgerNotification = {
          type: "created",
          amount: expectedEntry.amount,
          description: `Steward attendance points: +${expectedEntry.amount}`,
        };

        return {
          success: true,
          transactions: [transaction],
          notifications: [notification],
          message: `Created attendance entry for ${expectedEntry.amount} points - ${expectedEntry.description}`,
        };
      }

      if (expectedEntry && existingEntry) {
        const amountChanged = existingEntry.amount !== expectedEntry.amount;
        const memoChanged = existingEntry.memo !== expectedEntry.description;

        if (!amountChanged && !memoChanged) {
          logger.debug("Ledger entry matches expected state, no update needed", {
            service: "charge-plugin-btu-steward-attendance",
            participantId: participantContext.participantId,
            entryId: existingEntry.id,
          });
          return {
            success: true,
            transactions: [],
            message: "Ledger entry already matches expected state",
          };
        }

        await storage.ledger.entries.update(existingEntry.id, {
          amount: expectedEntry.amount,
          memo: expectedEntry.description,
          data: expectedEntry.metadata,
        });

        logger.info("Updated steward attendance points entry", {
          service: "charge-plugin-btu-steward-attendance",
          participantId: participantContext.participantId,
          entryId: existingEntry.id,
          previousAmount: existingEntry.amount,
          newAmount: expectedEntry.amount,
        });

        const notification: LedgerNotification = {
          type: "updated",
          amount: expectedEntry.amount,
          previousAmount: existingEntry.amount,
          description: amountChanged 
            ? `Steward attendance points updated: ${existingEntry.amount} → ${expectedEntry.amount}`
            : `Steward attendance entry updated`,
        };

        return {
          success: true,
          transactions: [],
          notifications: [notification],
          message: `Updated entry: amount ${existingEntry.amount} → ${expectedEntry.amount}`,
        };
      }

      return {
        success: true,
        transactions: [],
        message: "No action taken",
      };

    } catch (error) {
      logger.error("BTU Steward Attendance plugin execution failed", {
        service: "charge-plugin-btu-steward-attendance",
        participantId: participantContext.participantId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        transactions: [],
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  async verifyEntry(
    entry: Ledger,
    config: ChargePluginConfig
  ): Promise<LedgerEntryVerification> {
    const baseResult: LedgerEntryVerification = {
      entryId: entry.id,
      chargePlugin: entry.chargePlugin,
      chargePluginKey: entry.chargePluginKey,
      isValid: true,
      discrepancies: [],
      actualAmount: entry.amount,
      expectedAmount: null,
      actualDescription: entry.memo,
      expectedDescription: null,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      transactionDate: entry.date,
    };

    try {
      const validationResult = this.validateSettings(config.settings);
      if (!validationResult.valid) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [`Invalid plugin configuration: ${validationResult.errors?.join(", ")}`],
        };
      }

      const settings = config.settings as BtuStewardAttendanceSettings;

      if (!entry.referenceId) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry has no referenceId - cannot verify"],
        };
      }

      const data = entry.data as { 
        participantId?: string;
        eventId?: string;
        eventTypeId?: string;
        workerId?: string;
        contactId?: string;
        status?: string;
      } | null;
      
      if (!data?.participantId || !data?.eventId || !data?.eventTypeId || !data?.workerId || !data?.contactId) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry missing required metadata"],
        };
      }

      const isSteward = await storage.workerStewardAssignments.isWorkerSteward(data.workerId);

      const participantContext: ParticipantSavedContext = {
        trigger: TriggerType.PARTICIPANT_SAVED,
        participantId: data.participantId,
        eventId: data.eventId,
        eventTypeId: data.eventTypeId,
        contactId: data.contactId,
        role: "member",
        status: data.status || null,
        workerId: data.workerId,
        isSteward,
      };

      const expectedEntry = await this.computeExpectedEntry(participantContext, config, settings);

      if (!expectedEntry) {
        return {
          ...baseResult,
          isValid: false,
          expectedAmount: "0.00",
          expectedDescription: null,
          discrepancies: ["Entry exists but participant no longer qualifies - entry should be deleted"],
        };
      }

      const discrepancies: string[] = [];

      if (entry.amount !== expectedEntry.amount) {
        discrepancies.push(`Amount mismatch: expected ${expectedEntry.amount}, found ${entry.amount}`);
      }

      if (entry.memo !== expectedEntry.description) {
        discrepancies.push(`Description mismatch: expected "${expectedEntry.description}", found "${entry.memo}"`);
      }

      return {
        ...baseResult,
        isValid: discrepancies.length === 0,
        expectedAmount: expectedEntry.amount,
        expectedDescription: expectedEntry.description,
        discrepancies,
      };

    } catch (error) {
      return {
        ...baseResult,
        isValid: false,
        discrepancies: [`Verification error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
}

registerChargePlugin(new BtuStewardAttendancePlugin());
