import { eventBus, EventType, type DispatchSavedPayload } from "./event-bus";
import { createWorkerDispatchStatusStorage } from "../storage/worker-dispatch-status";
import { logger } from "../logger";

const SERVICE_NAME = "dispatch-seniority-reset";

let handlerId: string | undefined;

async function handleDispatchSaved(payload: DispatchSavedPayload): Promise<void> {
  if (payload.status !== "notified" || payload.previousStatus === "notified") {
    return;
  }

  const { workerId } = payload;

  try {
    const statusStorage = createWorkerDispatchStatusStorage();
    const now = new Date();

    await statusStorage.upsertByWorker(workerId, { seniorityDate: now });

    logger.info(`Reset seniority date for worker on notification`, {
      service: SERVICE_NAME,
      workerId,
      dispatchId: payload.dispatchId,
      jobId: payload.jobId,
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

  handlerId = eventBus.on(EventType.DISPATCH_SAVED, handleDispatchSaved);

  logger.info(`Dispatch seniority reset service initialized`, { service: SERVICE_NAME });
}

export function stopDispatchSeniorityReset(): void {
  if (handlerId) {
    eventBus.off(handlerId);
    handlerId = undefined;
  }
}
