import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { SUPPRESS_NOTIFICATIONS_HEADER } from '../../shared/notification-headers';

export interface RequestContext {
  userId?: string;
  userEmail?: string;
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
