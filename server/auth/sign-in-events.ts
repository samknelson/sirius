import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import type { LogInOptions } from "passport";
import type { AuthenticatedUser } from "./types";
import { normalizeSessionIp } from "./session-ip";
import { getRequestContext } from "../middleware/request-context";
import { getSessionAuthenticationContext, runWithSessionAuthentication } from "./session-authentication-context";

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
    runWithSessionAuthentication({ reason: "sign-in", userId, historyManaged: true }, () => {
      original.call(req, user, options, (error: unknown) => {
        if (error) return done(error);
        // Passport has regenerated AND saved the authenticated session.
        // Capture history before the provider returns its cookie/redirect, but
        // never wait for notification delivery and never fail a valid login.
        void (async () => {
          try {
            const { recordSuccessfulSignIn } = await import("../services/session-history");
            await recordSuccessfulSignIn({
              sid: req.sessionID, userId: userId!, ip,
              occurrenceId: randomUUID(), occurredAt: new Date().toISOString(),
              authenticationSessionReference: (user as AuthenticatedUser).authenticationSessionReference,
            });
          } catch {
            const { logger } = await import("../logger");
            logger.error("Sign-in observation failed", { service: "session-history" });
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
