import { domainToASCII } from "node:url";
import { getEnvironmentVariable, listEnvironmentVariables } from "../../config/env-registry";
import { WcEndpointPolicyError } from "./refusals";
import type { WcVendorDestinationPolicyView } from "@shared/webclient-destination-policy";

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
  return resolveVendorPolicy(pluginId, declaration, isKnownPlugin, raw).patterns;
}

/** One parser/selector for both invocation and the administrator's view. */
function resolveVendorPolicy(
  pluginId: string,
  declaration: WcEndpointPolicy | undefined,
  isKnownPlugin: (id: string) => boolean,
  raw: string | undefined,
): {
  patterns: AllowedVendorHosts;
  selection: "replacement" | "manifest" | "none";
} {
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
  return {
    patterns: effective,
    selection: override !== undefined ? "replacement"
      : declaration?.defaultAllowedHosts !== undefined ? "manifest" : "none",
  };
}

/** Shared by invocation and presentation; not a second enforcement decision. */
export function assertVendorDestinationTransport(
  pluginId: string,
  external: boolean,
  httpTransport: "webclient" | undefined,
  allowed: AllowedVendorHosts,
): void {
  if (external && allowed !== undefined && httpTransport !== "webclient") {
    throw new WcEndpointPolicyError(pluginId,
      "this SDK/browser transport cannot enforce an active destination allowlist; operation is unsupported");
  }
}

export function describeVendorDestinationPolicy(
  plugin: {
    id: string;
    endpointPolicy?: WcEndpointPolicy;
    service?: string;
    httpTransport?: "webclient";
  },
  isKnownPlugin: (id: string) => boolean,
): WcVendorDestinationPolicyView {
  const raw = getEnvironmentVariable("WEBCLIENT_VENDOR_ALLOWED_HOSTS");
  const source = listEnvironmentVariables().find(
    (variable) => variable.name === "WEBCLIENT_VENDOR_ALLOWED_HOSTS",
  )?.source ?? null;
  const base = {
    pluginId: plugin.id,
    requiresAllowlist: plugin.endpointPolicy?.requiresAllowlist === true,
    configurationSource: source,
    deploymentLocked: source === "environment",
  };
  const transport = !plugin.service ? "local"
    : plugin.httpTransport === "webclient" ? "guarded-http" : "unguarded";
  let policy: ReturnType<typeof resolveVendorPolicy>;
  try {
    policy = resolveVendorPolicy(plugin.id, plugin.endpointPolicy, isKnownPlugin, raw);
  } catch (error) {
    if (!(error instanceof WcEndpointPolicyError)) throw error;
    // Never relay raw malformed map contents or exception text to the UI.
    return { ...base, selection: "invalid", status: "invalid",
      effectivePatterns: null, transport };
  }
  let effectiveTransport: WcVendorDestinationPolicyView["transport"] = transport;
  try {
    assertVendorDestinationTransport(plugin.id, Boolean(plugin.service),
      plugin.httpTransport, policy.patterns);
  } catch (error) {
    if (!(error instanceof WcEndpointPolicyError)) throw error;
    effectiveTransport = "unsupported";
  }
  return {
    ...base,
    selection: policy.selection,
    status: policy.patterns === undefined ? "unrestricted"
      : policy.patterns.length === 0 ? "deny-all" : "restricted",
    effectivePatterns: policy.patterns ?? null,
    transport: effectiveTransport,
  };
}
