import { eventBus, EventType, type SessionSaveAfterPayload, type SessionTransitionPayload } from "../../../../server/services/event-bus";
import { isComponentEnabledSync } from "../../../../server/services/component/cache";
import { runOutsideTransaction } from "../../../../server/storage/transaction-context";
import type { SessionHistoryStorage } from "../storage/system/session-history";
import { logger } from "../../../../server/logger";
import { suppliedSessionUserAgent, withSessionUserAgent } from "../../../../shared/session-device";
import { getRequestContext } from "../../../../server/middleware/request-context";
import { alterHooks } from "../../../../shared/alter";
import { signInHistoryDecisionHook } from "../../../../server/auth/sign-in-events";

export function createSessionHistoryHandler(
  history: Pick<SessionHistoryStorage, "create">,
  isEnabled: () => boolean = () => isComponentEnabledSync("system.session_history"),
) {
  return async (transition: SessionTransitionPayload & { created?: boolean; signInHistoryManaged?: boolean }): Promise<void> => {
    // Live sessions can be anonymous, but their history is not retained.
    // In particular, do not attribute logout to the previous user.
    const userId = transition.userId;
    if (!userId) return;
    // The login observer records this exact opening after Passport succeeds;
    // do not race it by inserting the same IP first via the mutation listener.
    if (transition.signInHistoryManaged) return;
    if (
      !transition.created &&
      transition.previousUserId === transition.userId &&
      transition.previousIp === transition.ip &&
      (suppliedSessionUserAgent(transition.userAgent) === null ||
        transition.previousUserAgent === transition.userAgent)
    ) return;

    try {
      // Runtime gate: disabled components may have no physical table.
      if (!isEnabled()) return;
      // The after-commit listener retains its originating request's ALS scope.
      // Snapshot the verified UUID before scheduling the independent write.
      const deviceId = getRequestContext()?.deviceId ?? null;
      await runOutsideTransaction(() => history.create({
        sid: transition.sid,
        userId,
        ip: transition.ip,
        deviceId,
        timestamp: new Date(transition.occurredAt),
        data: withSessionUserAgent(null, transition.userAgent),
      }));
    } catch {
      // Driver errors may contain query parameters (including a cookie sid).
      // Do not relay the error, snapshot, or credentials into the bus/logs.
      logger.error("Session history capture failed", { service: "session-history" });
    }
  };
}

let initialized = false;
export function initializeSessionHistoryListener(history: Pick<SessionHistoryStorage, "create" | "recordSignIn">): void {
  if (initialized) return;
  initialized = true;
  alterHooks.register(signInHistoryDecisionHook, {
    id: "system.session_history.sign-in-decision",
    component: "system.session_history",
    priority: 0,
    description: "Record and classify the signing-in account before sign-in alerts",
    metadata: {},
    alter: (_previous, observation) => runOutsideTransaction(() => history.recordSignIn({
      id: observation.occurrenceId, sid: observation.sid,
      userId: observation.userId, ip: observation.ip,
      deviceId: observation.deviceId ?? null,
      timestamp: new Date(observation.occurredAt),
      data: withSessionUserAgent(null, observation.userAgent),
      authenticationSessionReference: observation.authenticationSessionReference,
    })),
  });
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
