import { domainToASCII } from "node:url";
import { getEnvironmentVariable } from "../../config/env-registry";
import { WcEndpointPolicyError } from "./refusals";

export interface WcEndpointPolicy {
  requiresAllowlist: boolean;
  defaultAllowedHosts?: readonly string[];
}

export type AllowedVendorHosts = readonly string[] | undefined;

function invalid(pluginId: string, reason: string): never {
  throw new WcEndpointPolicyError(pluginId, reason);
}

/** Deliberately not glob/regex matching. A wildcard only matches SUBdomains. */
export function normalizeHostPattern(pattern: unknown, pluginId: string): string {
  if (typeof pattern !== "string" || pattern !== pattern.trim()) {
    return invalid(pluginId, "host patterns must be nonempty hostname strings");
  }
  const wildcard = pattern.startsWith("*.");
  const raw = wildcard ? pattern.slice(2) : pattern;
  const host = domainToASCII(raw).toLowerCase().replace(/\.$/, "");
  if (
    !host || host.length > 253 || /[/:@?#\\\s*%]/.test(raw) ||
    !host.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    return invalid(pluginId, "use exact hostnames or a leading *. subdomain pattern, not URLs");
  }
  return `${wildcard ? "*." : ""}${host}`;
}

export function hostMatches(host: string, patterns: readonly string[]): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return patterns.some((pattern) => pattern.startsWith("*.")
    ? normalized.endsWith(pattern.slice(1)) && normalized !== pattern.slice(2)
    : normalized === pattern);
}

/**
 * Read on every operation/request: no connection/provider can retain a broader
 * policy after the normal environment override cache has picked up an edit.
 * The supplied registry membership check includes component-disabled plugins.
 */
export function resolveVendorAllowedHosts(
  pluginId: string,
  declaration: WcEndpointPolicy | undefined,
  isKnownPlugin: (id: string) => boolean,
  raw = getEnvironmentVariable("WEBCLIENT_VENDOR_ALLOWED_HOSTS"),
): AllowedVendorHosts {
  let override: string[] | undefined;
  if (raw !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      return invalid(pluginId, "WEBCLIENT_VENDOR_ALLOWED_HOSTS must be a JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return invalid(pluginId, "WEBCLIENT_VENDOR_ALLOWED_HOSTS must be a JSON object");
    }
    for (const [id, hosts] of Object.entries(parsed)) {
      if (!isKnownPlugin(id)) {
        return invalid(pluginId, `WEBCLIENT_VENDOR_ALLOWED_HOSTS names unknown vendor '${id}'`);
      }
      if (!Array.isArray(hosts)) {
        return invalid(pluginId, `WEBCLIENT_VENDOR_ALLOWED_HOSTS entry '${id}' must be a host-pattern array`);
      }
      const normalized = hosts.map((host) => normalizeHostPattern(host, id));
      if (id === pluginId) override = normalized;
    }
  }
  const effective = override ?? declaration?.defaultAllowedHosts?.map((host) =>
    normalizeHostPattern(host, pluginId));
  if (declaration?.requiresAllowlist && effective === undefined) {
    return invalid(pluginId, "this vendor requires a destination allowlist but none is configured");
  }
  return effective;
}
