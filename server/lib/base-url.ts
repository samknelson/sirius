import { getEnvironmentVariable } from "../config/env-registry";

/**
 * Absolute base URL of this deployment, for links that leave the app
 * (email, SMS). In-app messages navigate with relative paths instead.
 *
 * Thin wrapper over the registry-resolved PUBLIC_URL — explicit value,
 * Replit platform domains, or a localhost last resort — so all consumers
 * share one canonical answer.
 */
export function absoluteBaseUrl(): string {
  // The PUBLIC_URL transform always yields a value.
  return getEnvironmentVariable("PUBLIC_URL")!;
}

/** Prefix a relative path with the absolute base URL. */
export function absoluteUrl(relative: string): string {
  return `${absoluteBaseUrl()}${relative}`;
}
