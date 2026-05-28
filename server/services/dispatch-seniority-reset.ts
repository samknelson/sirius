import { eventBus, EventType, type DispatchSavedPayload } from "./event-bus";
import { createWorkerDispatchStatusStorage } from "../storage/dispatch/worker-status";
import { getSeniorityResetSettings } from "../modules/dispatch/seniority-reset-config";
import { storage } from "../storage";
import { logger } from "../logger";

const SERVICE_NAME = "dispatch-seniority-reset";

let handlerId: string | undefined;

async function handleDispatchSaved(payload: DispatchSavedPayload): Promise<void> {
  if (payload.previousStatus === payload.status) {
    return;
  }

  let triggerStatuses: readonly string[];
  try {
    const settings = await getSeniorityResetSettings(storage);
    triggerStatuses = settings.triggerStatuses;
  } catch (error) {
    logger.error(`Failed to load seniority-reset config; skipping`, {
      service: SERVICE_NAME,
      dispatchId: payload.dispatchId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!triggerStatuses.includes(payload.status)) {
    return;
  }

  const { workerId } = payload;

  try {
    const statusStorage = createWorkerDispatchStatusStorage();
    const now = new Date();

    await statusStorage.upsertByWorker(workerId, { seniorityDate: now });

    logger.info(`Reset seniority date for worker on status transition`, {
      service: SERVICE_NAME,
      workerId,
      dispatchId: payload.dispatchId,
      jobId: payload.jobId,
      status: payload.status,
      seniorityDate: now.toISOString(),
    });
  } catch (error) {
    logger.error(`Failed to reset seniority date for worker`, {
      service: SERVICE_NAME,
      workerId,
      dispatchId: payload.dispatchId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function initDispatchSeniorityReset(): void {
  if (handlerId) {
    logger.warn(`Dispatch seniority reset already initialized`, { service: SERVICE_NAME });
    return;
  }

  handlerId = eventBus.on({
    name: "dispatch-seniority-reset",
    description: "Resets a worker's seniority date when their dispatch transitions to a configured trigger status.",
    event: EventType.DISPATCH_SAVED,
    handler: handleDispatchSaved,
  });

  logger.info(`Dispatch seniority reset service initialized`, { service: SERVICE_NAME });
}

export function stopDispatchSeniorityReset(): void {
  if (handlerId) {
    eventBus.off(handlerId);
    handlerId = undefined;
  }
}
