import type { WcDuration, WcRequestBehavior, WcService } from "./types";

/**
 * Declared caching behavior, one entry per (service, request type).
 *
 * Entries are registered by the module that owns the call, not collected in
 * one list here: the freshness window for a phone lookup is a phone setting,
 * and a central list would either duplicate it or have to reach across the
 * app to read it.
 */
const behaviors = new Map<string, WcRequestBehavior<any>>();

function keyOf(service: WcService, requestType: string): string {
  return `${service}:${requestType}`;
}

export function registerWcRequest<TArgs>(behavior: WcRequestBehavior<TArgs>): void {
  const key = keyOf(behavior.service, behavior.requestType);
  const existing = behaviors.get(key);
  if (existing && existing !== behavior) {
    throw new Error(
      `Web client request "${key}" is already registered. Two behaviors for one ` +
        `request type means two different answers stored on one row.`,
    );
  }
  behaviors.set(key, behavior);
}

export function getWcRequest(
  service: WcService,
  requestType: string,
): WcRequestBehavior<any> | undefined {
  return behaviors.get(keyOf(service, requestType));
}

/**
 * Every registered behavior. Used by the sweep to work out what "past its
 * useful life" means for each request type.
 */
export function listWcRequests(): WcRequestBehavior<any>[] {
  return Array.from(behaviors.values());
}

/** Resolve a window to milliseconds, now, at the moment it is being judged. */
export async function resolveWcDuration(duration: WcDuration): Promise<number> {
  const value = typeof duration === "function" ? await duration() : duration;
  return Number.isFinite(value) && value > 0 ? value : 0;
}
