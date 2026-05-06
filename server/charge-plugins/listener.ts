import { eventBus, EventType, HoursSavedPayload, PaymentSavedPayload, WmbSavedPayload, ParticipantSavedPayload, CronPayload } from "../services/event-bus";
import { executeChargePlugins } from "./executor";
import { TriggerType } from "./types";
import { logger } from "../logger";

export function registerChargePluginListeners(): void {
  logger.info("Registering charge plugin event listeners", {
    service: "charge-plugin-listener",
  });

  eventBus.on(EventType.HOURS_SAVED, async (payload: HoursSavedPayload) => {
    try {
      const result = await executeChargePlugins({
        trigger: TriggerType.HOURS_SAVED,
        ...payload,
      });
      
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
  });

  eventBus.on(EventType.PAYMENT_SAVED, async (payload: PaymentSavedPayload) => {
    try {
      const result = await executeChargePlugins({
        trigger: TriggerType.PAYMENT_SAVED,
        ...payload,
      });
      
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
  });

  eventBus.on(EventType.WMB_SAVED, async (payload: WmbSavedPayload) => {
    try {
      const result = await executeChargePlugins({
        trigger: TriggerType.WMB_SAVED,
        ...payload,
      });
      
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
  });

  eventBus.on(EventType.PARTICIPANT_SAVED, async (payload: ParticipantSavedPayload) => {
    try {
      const result = await executeChargePlugins({
        trigger: TriggerType.PARTICIPANT_SAVED,
        ...payload,
      });
      
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
  });

  eventBus.on(EventType.CRON, async (payload: CronPayload) => {
    try {
      const result = await executeChargePlugins({
        trigger: TriggerType.CRON,
        ...payload,
      });
      
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
  });

  logger.info("Charge plugin event listeners registered", {
    service: "charge-plugin-listener",
    handlerCount: eventBus.getHandlerCount(),
  });
}
