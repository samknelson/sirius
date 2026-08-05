import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
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
  /**
   * When true, WMB rows being written in this async scope originate from the
   * benefits scan itself. The WMB auto-rescan listener checks this flag and
   * skips enqueuing, so a scan's own creates/deletes never feed back into the
   * scan queue (no self-amplifying loop). Set only via {@link withWmbScanWrites}
   * around the scan's execution phase.
   */
  wmbScanWrite?: boolean;
  /**
   * When true, the charge-plugin executor refuses to run any charge plugin
   * within this async scope (it logs and returns an empty result instead).
   * This is the S1→S2 migration mode: bulk loaders (e.g. the T20 hours
   * loader) write core rows through storage, and those writes must NOT
   * generate new ledger charges — historical ledger state arrives via its own
   * loader, so re-running hour-driven plugins would double-bill. Set only via
   * {@link withChargePluginsSuppressed}; there is deliberately no HTTP header
   * for this (it is a loader/operator concern, never a client opt-in).
   */
  suppressChargePlugins?: boolean;
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
 * Whether charge-plugin execution is suppressed for this async scope
 * (migration mode). Read by the charge-plugin executor. Returns false when
 * there is no ambient context (normal requests, crons), preserving the
 * charge-normally default.
 */
export function areChargePluginsSuppressed(): boolean {
  return requestContext.getStore()?.suppressChargePlugins === true;
}

/**
 * Run `fn` in a nested request context with charge-plugin execution turned
 * OFF (migration mode). Any storage writes inside `fn` that would normally
 * trigger charge plugins (e.g. worker_hours upserts firing HOURS_SAVED into
 * the executor) produce no ledger transactions; every other listener (events,
 * audit, cache invalidation) runs normally. Suppression applies only for the
 * duration of `fn`; the surrounding context is restored automatically on
 * return, so the flag can never be accidentally left on.
 */
export function withChargePluginsSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const current = requestContext.getStore();
  const next: RequestContext = { ...(current ?? {}), suppressChargePlugins: true };
  return requestContext.run(next, fn);
}

/**
 * Whether the current async scope is executing benefits-scan writes. Read by
 * the WMB auto-rescan listener to ignore WMB_SAVED events produced by the scan
 * itself. Returns false when there is no ambient context (normal requests,
 * crons), so manual admin edits enqueue normally.
 */
export function isWmbScanWrite(): boolean {
  return requestContext.getStore()?.wmbScanWrite === true;
}

/**
 * Run `fn` in a nested request context marked as benefits-scan writes. Any
 * WMB_SAVED events emitted inside `fn` are ignored by the WMB auto-rescan
 * listener (loop guard); every other listener (charges, audit) runs normally.
 * The surrounding context is restored automatically on return.
 */
export function withWmbScanWrites<T>(fn: () => Promise<T>): Promise<T> {
  const current = requestContext.getStore();
  const next: RequestContext = { ...(current ?? {}), wmbScanWrite: true };
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

  // If user is authenticated, resolve the *effective* user via the canonical
  // getEffectiveUser helper (dynamic import — masquerade.ts imports this
  // module, so a static import would be circular). While masquerading, the
  // effective actor is the masqueraded user — matching what access policies
  // and the UI already show — and the real session user is preserved in
  // originalUserId/originalUserEmail. getEffectiveUser also self-heals stale
  // masquerade sessions by falling back to the real user.
  const user = req.user as any;
  if (user?.claims?.sub || user?.dbUser) {
    try {
      const { getEffectiveUser } = await import("../modules/masquerade");
      const { dbUser, originalUser } = await getEffectiveUser((req as any).session ?? {}, user);
      if (dbUser) {
        context.userId = dbUser.id;
        context.userEmail = dbUser.email ?? undefined;
        if (originalUser && originalUser.id !== dbUser.id) {
          context.originalUserId = originalUser.id;
          context.originalUserEmail = originalUser.email ?? undefined;
        }
      }
    } catch (error) {
      // Log but don't block request if user lookup fails
      logger.error('Failed to fetch user context', { error });
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
