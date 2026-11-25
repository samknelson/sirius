import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import type { LogInOptions } from "passport";
import type { AuthenticatedUser } from "./types";
import { normalizeSessionIp } from "./session-ip";
import { getRequestContext } from "../middleware/request-context";
import { getSessionAuthenticationContext, runWithSessionAuthentication } from "./session-authentication-context";
import { alterHooks, AlterExecutionError } from "@shared/alter";
import { eventBus, EventType, type SignInAfterPayload } from "../services/event-bus";
import { runOutsideTransaction } from "../storage/transaction-context";
import { suppliedSessionUserAgent } from "@shared/session-device";
import { logger } from "../logger";

/** Private observation facts. Never spread this context into a public event. */
export type SuccessfulSignInObservation = Readonly<
  Pick<SignInAfterPayload, "occurrenceId" | "userId" | "ip" | "occurredAt"> & {
    sid: string;
    authenticationSessionReference?: string;
    userAgent?: string | null;
    deviceId?: string | null;
  }
>;

export type SuccessfulSignInHistoryDecision = Pick<SignInAfterPayload, "ipDecision" | "deviceDecision">;

export const signInHistoryDecisionHook = alterHooks.declare<SuccessfulSignInHistoryDecision, SuccessfulSignInObservation>({
  id: "auth.sign-in.history-decision",
  description: "Classify a successful sign-in against optional retained history",
  semantics: "Capture history in an independent transaction and return only decisions. Never change authentication authority. Private context must not be published. The consumer fails open to null decisions on failure.",
});

export async function recordSuccessfulSignIn(observation: SuccessfulSignInObservation): Promise<void> {
  let decisions: SuccessfulSignInHistoryDecision = { ipDecision: null, deviceDecision: null };
  try {
    decisions = await alterHooks.run(signInHistoryDecisionHook, Object.freeze(decisions), Object.freeze({ ...observation }));
  } catch (error) {
    // Deliberately fail open for optional enrichment, not for authentication.
    // No exception text or private observation values may enter logs.
    logger.error("Sign-in history decision failed", {
      hookId: signInHistoryDecisionHook.id,
      ...(error instanceof AlterExecutionError ? { callbackId: error.callbackId } : {}),
    });
  }
  if (decisions.ipDecision === "restored-session") return;
  const payload: SignInAfterPayload = Object.freeze({
    occurrenceId: observation.occurrenceId, userId: observation.userId,
    ip: observation.ip, occurredAt: observation.occurredAt,
    ipDecision: decisions.ipDecision, deviceDecision: decisions.deviceDecision,
    userAgent: suppliedSessionUserAgent(observation.userAgent),
  });
  // Do not await delivery, and escape the caller's transaction/after-commit scope.
  void runOutsideTransaction(() => eventBus.emit(EventType.AUTH_SIGN_IN_AFTER, payload))
    .catch(() => logger.error("Sign-in event delivery failed", { service: "authentication" }));
}

/**
 * Observe Passport's existing login function; providers still verify identities,
 * establish sessions and return responses exactly as before. Both aliases must
 * be wrapped: passport.authenticate itself uses logIn.
 */
export const observeSuccessfulSignIns: RequestHandler = (req, _res, next) => {
  const original = req.logIn;
  const observed: typeof req.logIn = function (
    user: Express.User,
    optionsOrDone: LogInOptions | ((error?: unknown) => void),
    suppliedDone?: (error?: unknown) => void,
  ) {
    const options: LogInOptions = typeof optionsOrDone === "function" ? { session: true } : optionsOrDone;
    const done = typeof optionsOrDone === "function" ? optionsOrDone : suppliedDone;
    const userId = (user as AuthenticatedUser).dbUser?.id;
    const isSignIn = options.session !== false &&
      getSessionAuthenticationContext()?.reason !== "restore" && !!userId;
    if (!isSignIn || !done) {
      return original.call(req, user, options, done!);
    }
    const ip = normalizeSessionIp(getRequestContext()?.ipAddress);
    const userAgent = getRequestContext()?.userAgent;
    const deviceId = getRequestContext()?.deviceId;
    runWithSessionAuthentication({ reason: "sign-in", userId, historyManaged: true }, () => {
      original.call(req, user, options, (error: unknown) => {
        if (error) return done(error);
        // Passport has regenerated AND saved the authenticated session.
        // Capture history before the provider returns its cookie/redirect, but
        // never wait for notification delivery and never fail a valid login.
        void (async () => {
          try {
            await recordSuccessfulSignIn({
              sid: req.sessionID, userId: userId!, ip, userAgent, deviceId,
              occurrenceId: randomUUID(), occurredAt: new Date().toISOString(),
              authenticationSessionReference: (user as AuthenticatedUser).authenticationSessionReference,
            });
          } catch {
            logger.error("Sign-in observation failed", { service: "authentication" });
          } finally {
            done();
          }
        })();
      });
    });
  };
  req.login = req.logIn = observed;
  next();
};
