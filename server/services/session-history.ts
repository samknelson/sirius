import { eventBus, EventType, type SessionSaveAfterPayload, type SessionTransitionPayload, type SignInAfterPayload } from "./event-bus";
import { isComponentEnabledSync } from "./component-cache";
import { runOutsideTransaction } from "../storage/transaction-context";
import type { SessionHistoryStorage } from "../storage/system/session-history";
import { logger } from "../logger";
import { suppliedSessionUserAgent, withSessionUserAgent } from "../../shared/session-device";

export function createSessionHistoryHandler(
  history: Pick<SessionHistoryStorage, "create">,
  isEnabled: () => boolean = () => isComponentEnabledSync("system.session_history"),
) {
  return async (transition: SessionTransitionPayload & { created?: boolean; signInHistoryManaged?: boolean }): Promise<void> => {
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
      await runOutsideTransaction(() => history.create({
        sid: transition.sid,
        userId: transition.userId,
        ip: transition.ip,
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
let signInHistory: Pick<SessionHistoryStorage, "recordSignIn"> | undefined;

export function initializeSessionHistoryListener(history: Pick<SessionHistoryStorage, "create"> & Partial<Pick<SessionHistoryStorage, "recordSignIn">>): void {
  if (initialized) return;
  initialized = true;
  if (history.recordSignIn) signInHistory = history as Pick<SessionHistoryStorage, "recordSignIn">;
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

export async function recordSuccessfulSignIn(
  observation: Omit<SignInAfterPayload, "ipDecision"> & { sid: string; authenticationSessionReference?: string; userAgent?: string | null },
): Promise<void> {
  let ipDecision: SignInAfterPayload["ipDecision"] = null;
  try {
    if (isComponentEnabledSync("system.session_history")) {
      if (!signInHistory) throw new Error("Sign-in history capture is not initialized");
      ipDecision = await runOutsideTransaction(() => signInHistory!.recordSignIn({
        id: observation.occurrenceId, sid: observation.sid,
        userId: observation.userId, ip: observation.ip,
        timestamp: new Date(observation.occurredAt), data: withSessionUserAgent(null, observation.userAgent),
        authenticationSessionReference: observation.authenticationSessionReference,
      }));
    }
  } catch {
    // No driver messages: they can contain the cookie identifier.
    logger.error("Sign-in history capture failed", { service: "session-history" });
  }
  if (ipDecision === "restored-session") return;
  const payload: SignInAfterPayload = Object.freeze({
    occurrenceId: observation.occurrenceId, userId: observation.userId,
    ip: observation.ip, occurredAt: observation.occurredAt, ipDecision,
  });
  // Sign-in succeeds regardless of vendor/delivery failure.
  void runOutsideTransaction(() => eventBus.emit(EventType.AUTH_SIGN_IN_AFTER, payload))
    .catch(() => logger.error("Sign-in event delivery failed", { service: "session-history" }));
}
