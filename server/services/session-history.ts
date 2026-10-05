import { eventBus, EventType, type SessionSaveAfterPayload, type SessionTransitionPayload } from "./event-bus";
import { isComponentEnabledSync } from "./component-cache";
import { runOutsideTransaction } from "../storage/transaction-context";
import type { SessionHistoryStorage } from "../storage/system/session-history";
import { logger } from "../logger";

export function createSessionHistoryHandler(
  history: SessionHistoryStorage,
  isEnabled: () => boolean = () => isComponentEnabledSync("system.session_history"),
) {
  return async (transition: SessionTransitionPayload & { created?: boolean }): Promise<void> => {
    if (
      !transition.created &&
      transition.previousUserId === transition.userId &&
      transition.previousIp === transition.ip
    ) return;

    try {
      // Runtime gate: disabled components may have no physical table.
      if (!isEnabled()) return;
      await runOutsideTransaction(() => history.create({
        sid: transition.sid,
        userId: transition.userId,
        ip: transition.ip,
        timestamp: new Date(transition.occurredAt),
        data: null,
      }));
    } catch {
      // Driver errors may contain query parameters (including a cookie sid).
      // Do not relay the error, snapshot, or credentials into the bus/logs.
      logger.error("Session history capture failed", { service: "session-history" });
    }
  };
}

let initialized = false;

export function initializeSessionHistoryListener(history: SessionHistoryStorage): void {
  if (initialized) return;
  initialized = true;
  const handler = createSessionHistoryHandler(history);
  eventBus.on({
    name: "session-history-save",
    description: "Record session opening and user/IP transitions",
    event: EventType.SESSION_SAVE_AFTER,
    handler: (payload: SessionSaveAfterPayload) => handler(payload),
  });
  eventBus.on({
    name: "session-history-touch",
    description: "Record IP transitions during session touches",
    event: EventType.SESSION_TOUCH_AFTER,
    handler,
  });
}
