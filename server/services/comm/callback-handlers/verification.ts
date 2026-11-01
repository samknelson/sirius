import type { Request, Response, NextFunction } from "express";
import {
  getEnvironmentVariable,
  registerEnvironmentVariable,
} from "../../../config/env-registry";

export type CallbackRequest = Request & { rawCallbackBody?: Buffer };

function isCallback(req: Request): boolean {
  return req.method === "POST" && /^\/api\/comm\/statuscallback\/[^/]+\/?$/i.test(req.path);
}

/** Install as express.json's verify hook, before JSON decoding. Never stringify. */
export function captureCallbackBody(req: Request, _res: unknown, bytes: Buffer): void {
  if (isCallback(req)) {
    (req as CallbackRequest).rawCallbackBody = Buffer.from(bytes);
  }
}

/** JSON parse errors carry the body and may quote it in their message/stack.
 * Refuse locally instead of passing those errors to the general error logger.
 */
export function refuseCallbackParseError(
  error: { type?: string; status?: number }, req: Request, res: Response, next: NextFunction,
): void {
  if (isCallback(req) && error.type?.startsWith("entity.")) {
    res.status(error.status === 413 ? 413 : 400).send("Invalid callback body");
    return;
  }
  next(error);
}

/** Both vendors sign the delivery timestamp, not the event's creation time.
 * Retries with a fresh delivery signature remain valid; old captured requests do not.
 */
export function freshTimestamp(value: unknown, now = Date.now()): value is string {
  return typeof value === "string" &&
    /^\d{10}$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Math.abs(now / 1000 - Number(value)) <= 300;
}

export async function verificationConfig(providerId: "sendgrid" | "lob", vendorConfigId?: string) {
  const { storage } = await import("../../../storage");
  const configs = await storage.pluginConfigs.getByKindAndPlugin("wc-vendors", providerId);
  if (vendorConfigId) {
    const config = configs.find((row) => row.id === vendorConfigId);
    if (!config) throw new Error("Callback configuration no longer exists");
    return (config.data ?? {}) as Record<string, unknown>;
  }
  // No account identifier is signed by these protocols. Never guess among keys,
  // or fall back to an API credential for legacy sends without a recorded config.
  // Retained in-flight configs may be disabled.
  if (configs.length !== 1) throw new Error("Missing or ambiguous callback configuration");
  return (configs[0].data ?? {}) as Record<string, unknown>;
}

export function webhookSecret(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) throw new Error("Missing webhook secret name");
  registerEnvironmentVariable({
    name: name.trim(),
    description: "Lob webhook signing secret named by vendor configuration (not the API key).",
    secret: true,
    category: "webclient",
    changeTakesEffect: "immediate",
  });
  const value = getEnvironmentVariable(name.trim());
  // Lob's debugger uses a publicly known key, never a production authenticator.
  if (!value || value === "secret") throw new Error("Unavailable webhook secret");
  return value;
}
