import { domainToASCII } from "node:url";
import { getEnvironmentVariable, listEnvironmentVariables } from "../../config/env-registry";
import { WcEndpointPolicyError } from "./refusals";
import type { WcVendorDestinationPolicyView } from "@shared/webclient-destination-policy";

export interface WcEndpointPolicy {
  requiresAllowlist: boolean;
  defaultAllowedHosts?: readonly string[];
}

export interface VendorDestinationPolicy {
  allowedHosts: readonly string[] | undefined;
  allowPrivateAddresses: boolean;
}

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
export function resolveVendorDestinationPolicy(
  pluginId: string,
  declaration: WcEndpointPolicy | undefined,
  isKnownPlugin: (id: string) => boolean,
  raw = getEnvironmentVariable("WEBCLIENT_VENDOR_ALLOWED_HOSTS"),
): VendorDestinationPolicy {
  return resolveVendorPolicy(pluginId, declaration, isKnownPlugin, raw);
}

/** One parser/selector for both invocation and the administrator's view. */
function resolveVendorPolicy(
  pluginId: string,
  declaration: WcEndpointPolicy | undefined,
  isKnownPlugin: (id: string) => boolean,
  raw: string | undefined,
): {
  allowedHosts: readonly string[] | undefined;
  allowPrivateAddresses: boolean;
  selection: "replacement" | "manifest" | "none";
} {
  let override: VendorDestinationPolicy | undefined;
  if (raw !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      return invalid(pluginId, "WEBCLIENT_VENDOR_ALLOWED_HOSTS must be a JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return invalid(pluginId, "WEBCLIENT_VENDOR_ALLOWED_HOSTS must be a JSON object");
    }
    for (const [id, entry] of Object.entries(parsed)) {
      if (!isKnownPlugin(id)) {
        return invalid(pluginId, `WEBCLIENT_VENDOR_ALLOWED_HOSTS names unknown vendor '${id}'`);
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return invalid(pluginId, `WEBCLIENT_VENDOR_ALLOWED_HOSTS entry '${id}' must be an object with allowedHosts and optional allowPrivateAddresses; legacy host arrays are not supported`);
      }
      const value = entry as Record<string, unknown>;
      if (Object.keys(value).some((key) => !["allowedHosts", "allowPrivateAddresses"].includes(key)) ||
          !Array.isArray(value.allowedHosts) ||
          (value.allowPrivateAddresses !== undefined && typeof value.allowPrivateAddresses !== "boolean")) {
        return invalid(pluginId, `WEBCLIENT_VENDOR_ALLOWED_HOSTS entry '${id}' requires an allowedHosts array and optional boolean allowPrivateAddresses; no other fields are accepted`);
      }
      const normalized = value.allowedHosts.map((host) => normalizeHostPattern(host, id));
      if (id === pluginId) override = {
        allowedHosts: normalized, allowPrivateAddresses: value.allowPrivateAddresses === true,
      };
    }
  }
  const effective = override?.allowedHosts ?? declaration?.defaultAllowedHosts?.map((host) =>
    normalizeHostPattern(host, pluginId));
  if (declaration?.requiresAllowlist && effective === undefined) {
    return invalid(pluginId, "this vendor requires a destination allowlist but none is configured");
  }
  return {
    allowedHosts: effective,
    allowPrivateAddresses: override?.allowPrivateAddresses ?? false,
    selection: override !== undefined ? "replacement"
      : declaration?.defaultAllowedHosts !== undefined ? "manifest" : "none",
  };
}

/** Shared by invocation and presentation; not a second enforcement decision. */
export function assertVendorDestinationTransport(
  pluginId: string,
  external: boolean,
  httpTransport: "webclient" | undefined,
  policy: VendorDestinationPolicy,
): void {
  if (external && policy.allowedHosts !== undefined && httpTransport !== "webclient") {
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
      effectivePatterns: null, allowPrivateAddresses: null, transport };
  }
  let effectiveTransport: WcVendorDestinationPolicyView["transport"] = transport;
  try {
    assertVendorDestinationTransport(plugin.id, Boolean(plugin.service),
      plugin.httpTransport, policy);
  } catch (error) {
    if (!(error instanceof WcEndpointPolicyError)) throw error;
    effectiveTransport = "unsupported";
  }
  return {
    ...base,
    selection: policy.selection,
    status: policy.allowedHosts === undefined ? "unrestricted"
      : policy.allowedHosts.length === 0 ? "deny-all" : "restricted",
    effectivePatterns: policy.allowedHosts ?? null,
    allowPrivateAddresses: policy.allowPrivateAddresses,
    transport: effectiveTransport,
  };
}
