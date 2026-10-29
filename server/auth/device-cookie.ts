import type { RequestHandler } from "express";
import { getEnvironmentVariable } from "../config/env-registry";
import { getRequestContext, requestContext } from "../middleware/request-context";
import { WEB_SERVICE_BASE_PATH } from "../modules/webservices/base-path";
import { logger } from "../logger";
import { getDeviceCookieKey } from "./device-cookie-key";
import {
  DEVICE_COOKIE_NAME, DEVICE_COOKIE_LIFETIME_SECONDS, readDeviceCookie, resolveDeviceCookie,
} from "./device-cookie-token";

/** Browser HTTP only. This does not read, create, or modify an express session. */
export function createDeviceCookieMiddleware(
  getKey: () => Promise<string> = getDeviceCookieKey,
  clock: () => number = Date.now,
): RequestHandler {
  return async (req, res, next) => {
    if (req.path === WEB_SERVICE_BASE_PATH || req.path.startsWith(`${WEB_SERVICE_BASE_PATH}/`) ||
        req.path === "/ws" || req.headers.upgrade?.toLowerCase() === "websocket") return next();
    let deviceId: string;
    try {
      const key = await getKey();
      const now = Math.floor(clock() / 1000);
      const result = resolveDeviceCookie(readDeviceCookie(req.headers.cookie), key, now);
      if (result.cookie) {
        res.cookie(DEVICE_COOKIE_NAME, result.cookie, {
          path: "/", httpOnly: true, sameSite: "lax",
          secure: req.secure || getEnvironmentVariable("NODE_ENV") === "production",
          maxAge: DEVICE_COOKIE_LIFETIME_SECONDS * 1000,
          expires: new Date((now + DEVICE_COOKIE_LIFETIME_SECONDS) * 1000),
        });
      }
      deviceId = result.uuid;
    } catch {
      // Key configuration/persistence failures must not block login. The resolver
      // leaves failed initialization uncached so a later request can retry.
      logger.warn("Browser identifier unavailable for this request", { source: "device-cookie" });
      return next();
    }
    return requestContext.run({ ...getRequestContext(), deviceId }, next);
  };
}
