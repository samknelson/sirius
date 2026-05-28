import { eventBus, EventType, HoursSavedPayload, PaymentSavedPayload, WmbSavedPayload, ParticipantSavedPayload, CronPayload } from "../../../services/event-bus";
import { executeChargePlugins } from "./executor";
import { TriggerType } from "./types";
import { logger } from "../../../logger";

async function handleHoursSaved(payload: HoursSavedPayload): Promise<void> {
  try {
    const result = await executeChargePlugins({ trigger: TriggerType.HOURS_SAVED, ...payload });
    if (result.totalTransactions.length > 0) {
      logger.debug("Charge plugins processed HOURS_SAVED event", {
        service: "charge-plugin-listener",
        hoursId: payload.hoursId,
        transactionCount: result.totalTransactions.length,
      });
    }
  } catch (error) {
    logger.error("Failed to process HOURS_SAVED event in charge plugins", {
      service: "charge-plugin-listener",
      hoursId: payload.hoursId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handlePaymentSaved(payload: PaymentSavedPayload): Promise<void> {
  try {
    const result = await executeChargePlugins({ trigger: TriggerType.PAYMENT_SAVED, ...payload });
    if (result.totalTransactions.length > 0) {
      logger.debug("Charge plugins processed PAYMENT_SAVED event", {
        service: "charge-plugin-listener",
        paymentId: payload.paymentId,
        transactionCount: result.totalTransactions.length,
      });
    }
  } catch (error) {
    logger.error("Failed to process PAYMENT_SAVED event in charge plugins", {
      service: "charge-plugin-listener",
      paymentId: payload.paymentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleWmbSaved(payload: WmbSavedPayload): Promise<void> {
  try {
    const result = await executeChargePlugins({ trigger: TriggerType.WMB_SAVED, ...payload });
    if (result.totalTransactions.length > 0) {
      logger.debug("Charge plugins processed WMB_SAVED event", {
        service: "charge-plugin-listener",
        wmbId: payload.wmbId,
        transactionCount: result.totalTransactions.length,
      });
    }
  } catch (error) {
    logger.error("Failed to process WMB_SAVED event in charge plugins", {
      service: "charge-plugin-listener",
      wmbId: payload.wmbId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleParticipantSaved(payload: ParticipantSavedPayload): Promise<void> {
  try {
    const result = await executeChargePlugins({ trigger: TriggerType.PARTICIPANT_SAVED, ...payload });
    if (result.totalTransactions.length > 0) {
      logger.debug("Charge plugins processed PARTICIPANT_SAVED event", {
        service: "charge-plugin-listener",
        participantId: payload.participantId,
        transactionCount: result.totalTransactions.length,
      });
    }
  } catch (error) {
    logger.error("Failed to process PARTICIPANT_SAVED event in charge plugins", {
      service: "charge-plugin-listener",
      participantId: payload.participantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleCron(payload: CronPayload): Promise<void> {
  try {
    const result = await executeChargePlugins({ trigger: TriggerType.CRON, ...payload });
    if (result.totalTransactions.length > 0) {
      logger.debug("Charge plugins processed CRON event", {
        service: "charge-plugin-listener",
        jobId: payload.jobId,
        transactionCount: result.totalTransactions.length,
      });
    }
  } catch (error) {
    logger.error("Failed to process CRON event in charge plugins", {
      service: "charge-plugin-listener",
      jobId: payload.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function registerChargePluginListeners(): void {
  logger.info("Registering charge plugin event listeners", {
    service: "charge-plugin-listener",
  });

  eventBus.on({
    name: "ledger-charge:hours-saved",
    description: "Runs all charge plugins registered for the HOURS_SAVED trigger.",
    event: EventType.HOURS_SAVED,
    handler: handleHoursSaved,
  });

  eventBus.on({
    name: "ledger-charge:payment-saved",
    description: "Runs all charge plugins registered for the PAYMENT_SAVED trigger.",
    event: EventType.PAYMENT_SAVED,
    handler: handlePaymentSaved,
  });

  eventBus.on({
    name: "ledger-charge:wmb-saved",
    description: "Runs all charge plugins registered for the WMB_SAVED trigger.",
    event: EventType.WMB_SAVED,
    handler: handleWmbSaved,
  });

  eventBus.on({
    name: "ledger-charge:participant-saved",
    description: "Runs all charge plugins registered for the PARTICIPANT_SAVED trigger.",
    event: EventType.PARTICIPANT_SAVED,
    handler: handleParticipantSaved,
  });

  eventBus.on({
    name: "ledger-charge:cron",
    description: "Runs all charge plugins registered for the CRON trigger.",
    event: EventType.CRON,
    handler: handleCron,
  });

  logger.info("Charge plugin event listeners registered", {
    service: "charge-plugin-listener",
    handlerCount: eventBus.getHandlerCount(),
  });
}
