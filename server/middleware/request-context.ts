import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';

export interface RequestContext {
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/**
 * Middleware to capture and store request context (user and IP)
 * Should be registered early in the middleware chain, after authentication
 */
export async function captureRequestContext(req: Request, res: Response, next: NextFunction) {
  const context: RequestContext = {
    ipAddress: getClientIp(req),
  };

  // If user is authenticated, add user information from already-attached dbUser
  const user = req.user as any;
  if (user?.dbUser) {
    context.userId = user.dbUser.id;
    context.userEmail = user.dbUser.email;
  } else if (user?.claims?.sub) {
    // Fallback: If dbUser wasn't attached during deserialization, fetch it now via auth_identities
    try {
      const externalId = user.claims.sub;
      const identity = await storage.authIdentities.getByProviderAndExternalId("replit", externalId);
      if (identity) {
        const dbUser = await storage.users.getUser(identity.userId);
        if (dbUser) {
          context.userId = dbUser.id;
          context.userEmail = dbUser.email;
          // Also attach to req.user for future middleware
          user.dbUser = dbUser;
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
