import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { SUPPRESS_NOTIFICATIONS_HEADER } from '../../shared/notification-headers';

export interface RequestContext {
  /**
   * The *effective* acting user for this request. When the session is
   * masquerading, this is the masqueraded user — the identity every other
   * layer (access policies, UI) already treats as the actor — so consumers
   * like the event-notifier's self-suppression key off the same identity.
   */
  userId?: string;
  userEmail?: string;
  /**
   * The real authenticated user behind an active masquerade. Only set while
   * masquerading; undefined otherwise. Consumers that need the true session
   * identity (rather than the effective actor) should read these.
   */
  originalUserId?: string;
  originalUserEmail?: string;
  ipAddress?: string;
  /**
   * When true, the event-notifier dispatcher skips sending notifications for
   * events fired within this async scope. Set either by the
   * `x-suppress-notifications` request header (see captureRequestContext) or
   * programmatically via {@link withNotificationsSuppressed}. Absent/false
   * means notify normally.
   */
  suppressNotifications?: boolean;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/**
 * Whether notifications are currently suppressed for this async scope. Read by
 * the event-notifier dispatcher. Returns false when there is no ambient
 * context (e.g. cron jobs, startup tasks), preserving the notify-by-default
 * behavior.
 */
export function areNotificationsSuppressed(): boolean {
  return requestContext.getStore()?.suppressNotifications === true;
}

/**
 * Run `fn` in a nested request context with notification suppression turned on.
 * Any events fired inside `fn` will not produce email / in-app / SMS / postal
 * notifications, while every other event listener (charges, audit, cache
 * invalidation, etc.) runs normally. Suppression applies only for the duration
 * of `fn`; the surrounding context is restored automatically on return, so the
 * flag can never be accidentally left on. Existing context fields (userId,
 * userEmail, ipAddress) are preserved.
 */
export function withNotificationsSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const current = requestContext.getStore();
  const next: RequestContext = { ...(current ?? {}), suppressNotifications: true };
  return requestContext.run(next, fn);
}

/**
 * Run `fn` in a nested request context with the acting user cleared, so events
 * fired inside `fn` are attributed to no one — a *system* action rather than the
 * authenticated request's user. This mirrors how a cron-driven emit has no
 * acting user: notifier listeners then neither self-suppress the operator's own
 * recipient nor leak their identity, regardless of any notifier's `notifySelf`
 * setting. Use it to force-fire a deferred event from inside an admin's HTTP
 * request (e.g. manually firing an EBS event). Other context fields (ipAddress,
 * suppressNotifications) are preserved; the surrounding context is restored on
 * return.
 */
export function withSystemActor<T>(fn: () => Promise<T>): Promise<T> {
  const current = requestContext.getStore();
  const next: RequestContext = {
    ...(current ?? {}),
    userId: undefined,
    userEmail: undefined,
    originalUserId: undefined,
    originalUserEmail: undefined,
  };
  return requestContext.run(next, fn);
}

/**
 * Middleware to capture and store request context (user and IP)
 * Should be registered early in the middleware chain, after authentication
 */
export async function captureRequestContext(req: Request, res: Response, next: NextFunction) {
  const context: RequestContext = {
    ipAddress: getClientIp(req),
  };

  // Client opt-in (e.g. bulk-update flows): suppress notifications that this
  // request's events would otherwise trigger. Non-notifier listeners are
  // unaffected — enforcement lives in the event-notifier dispatcher.
  if (req.headers[SUPPRESS_NOTIFICATIONS_HEADER] === 'true') {
    context.suppressNotifications = true;
  }

  // If user is authenticated, add user information via resolveDbUser helper
  const user = req.user as any;
  if (user?.claims?.sub) {
    try {
      const { resolveDbUser } = await import("../auth/helpers");
      const dbUser = await resolveDbUser(user, user.claims.sub);
      if (dbUser) {
        context.userId = dbUser.id;
        context.userEmail = dbUser.email;
      }
    } catch (error) {
      // Log but don't block request if user lookup fails
      logger.error('Failed to fetch user context', { error });
    }
  } else if (user?.dbUser) {
    // Fallback for edge case where dbUser exists but claims don't
    context.userId = user.dbUser.id;
    context.userEmail = user.dbUser.email;
  }

  // Masquerade: the effective actor for this request is the masqueraded user,
  // matching what access policies and the UI already show. Keep the real
  // session user available as originalUserId/originalUserEmail. On a lookup
  // failure (stale masqueradeUserId), fall back to the real user — the
  // masquerade route handlers own clearing broken sessions.
  const masqueradeUserId = (req as any).session?.masqueradeUserId;
  if (masqueradeUserId && context.userId && masqueradeUserId !== context.userId) {
    try {
      const masqueradedUser = await storage.users.getUser(masqueradeUserId);
      if (masqueradedUser) {
        context.originalUserId = context.userId;
        context.originalUserEmail = context.userEmail;
        context.userId = masqueradedUser.id;
        context.userEmail = masqueradedUser.email ?? undefined;
      }
    } catch (error) {
      logger.error('Failed to resolve masqueraded user for request context', { error });
    }
  }

  // Run the rest of the request in this async context
  requestContext.run(context, () => {
    next();
  });
}

/**
 * Extract client IP address from request
 * Handles proxies and load balancers
 */
function getClientIp(req: Request): string {
  // Check for X-Forwarded-For header (common with proxies/load balancers)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // Take the first IP if multiple are present
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }

  // Check for X-Real-IP header (nginx)
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Fall back to socket address
  return req.socket.remoteAddress || 'unknown';
}
