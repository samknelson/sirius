import type { Request, RequestHandler } from "express";
import { getEnvironmentVariable } from "../config/env-registry";
import { WEB_SERVICE_BASE_PATH } from "../modules/webservices/base-path";

// Express routes are case-insensitive and accept one trailing slash by default.
const normalizePath = (path: string) => path.toLowerCase().replace(/\/$/, "");

function httpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    return url;
  } catch {
    return;
  }
}

/** Accept only a single serialized HTTP(S) origin, never a URL or origin list. */
export function hasTrustedExplicitOrigin(origin: unknown): boolean {
  if (typeof origin !== "string") return false;
  const parsed = httpUrl(origin);
  return !!parsed && parsed.origin === origin &&
    parsed.origin === getEnvironmentVariable("PUBLIC_URL");
}

/** Missing provenance is not evidence of a same-origin request. */
export function hasTrustedBrowserOrigin(req: Request): boolean {
  if (req.get("Sec-Fetch-Site")?.toLowerCase() === "cross-site") return false;
  const origin = req.get("Origin");
  if (origin !== undefined) {
    // Origin must be a single serialized origin, not a URL with a path,
    // userinfo, query, fragment, or an origin list. Never fall back on failure.
    return hasTrustedExplicitOrigin(origin);
  }
  const referer = req.get("Referer");
  return !!referer && httpUrl(referer)?.origin === getEnvironmentVariable("PUBLIC_URL");
}

function isUpload(req: Request, path: string): boolean {
  if (req.method !== "POST") return false;
  return path === "/api/files" ||
    path === "/api/workers/contact-export" ||
    path === "/api/esigs/upload-document" ||
    path === "/api/btu-sig-import/upload-zip" ||
    path === "/api/btu-building-rep-import/upload-preview" ||
    /^\/api\/entity-files\/[^/]+\/[^/]+$/.test(path) ||
    /^\/api\/admin\/filesystems\/[^/]+\/upload$/.test(path) ||
    /^\/api\/wizards\/[^/]+\/dispatch\/[^/]+\/upload$/.test(path);
}

/**
 * Runs before parsers, session restoration and provider middleware. The SAML
 * getter names the route actually mounted at boot, not a live config value.
 *
 * Protocol exceptions are deliberately exact in method and route shape:
 * - SAML validates the assertion, never a browser session.
 * - WS dispatch authenticates credentials and terminates unknown operations.
 * - comm callbacks use their existing provider-specific validation, not RBAC.
 * An Authorization header on an ordinary API is NOT an exception.
 */
export function createBrowserRequestProtection(
  samlCallbackPath: () => string | undefined,
): RequestHandler {
  return (req, res, next) => {
    const path = normalizePath(req.path);
    const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method);
    // These existing GET handlers change the session / persist derived state.
    // Include HEAD because Express otherwise dispatches it to the GET handler.
    const mutatingRead = req.method !== "OPTIONS" && (
      path === "/api/logout" ||
      /^\/api\/dispatches\/[^/]+\/status-options$/.test(path)
    );
    if (safeMethod && !mutatingRead) return next();

    const callback = samlCallbackPath();
    if (req.method === "POST" && callback && path === normalizePath(callback)) return next();
    if (new RegExp(`^${WEB_SERVICE_BASE_PATH}/[^/]+/[^/]+$`, "i").test(path)) return next();
    if (req.method === "POST" && /^\/api\/comm\/statuscallback\/[^/]+$/.test(path)) return next();

    if (!hasTrustedBrowserOrigin(req)) {
      return res.status(403).json({
        message: "Request refused: a same-origin Origin or Referer is required.",
        code: "CSRF_ORIGIN_REFUSED",
      });
    }

    // Bodyless actions need no content type. Multipart is accepted only on
    // actual upload routes, and still has to pass the origin check above.
    const hasBody = !!req.headers["transfer-encoding"] || Number(req.headers["content-length"] ?? 0) > 0;
    if (!safeMethod && hasBody && !req.is("application/json") &&
        !(isUpload(req, path) && req.is("multipart/form-data"))) {
      return res.status(415).json({
        message: "This endpoint requires an application/json request body.",
        code: "JSON_BODY_REQUIRED",
      });
    }
    next();
  };
}
