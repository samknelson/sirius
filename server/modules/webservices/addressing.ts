/**
 * How a web service configuration is addressed in a URL — the ONE place both
 * directions of that mapping live.
 *
 * The dispatcher turns a URL segment into a configuration; the document
 * builder turns a configuration into the URL segment it publishes. If those
 * two disagree, the generated document promises calls that 404, or worse,
 * names one service at an address that reaches another. Keeping the inverse
 * next to the original is what makes them provably consistent.
 */
import { storage } from "../../storage";
import type { PluginConfig } from "@shared/schema";

/** A configuration's alias, trimmed, or null when it has none. */
export function aliasOf(config: PluginConfig): string | null {
  const data = (config.data ?? {}) as Record<string, unknown>;
  const alias = typeof data.alias === "string" ? data.alias.trim() : "";
  return alias || null;
}

/**
 * Resolve the configuration a request is addressed to.
 *
 * Resolution is by `plugin_configs.id` first, then by alias. Id wins so an
 * alias that happens to look like a configuration id can never shadow the real
 * record. An alias matching more than one configuration is refused rather than
 * silently picking one: the grant check still runs on whichever record won, so
 * there is no privilege escalation, but a client granted both services would
 * quietly reach the wrong one.
 */
export async function resolveConfiguration(
  configRef: string,
): Promise<
  | { ok: true; config: PluginConfig }
  | { ok: false; reason: "UNKNOWN_CONFIG" | "AMBIGUOUS_ALIAS" }
> {
  const byId = await storage.pluginConfigs.get(configRef);
  if (byId && byId.pluginKind === "web-service") {
    return { ok: true, config: byId };
  }

  const all = await storage.pluginConfigs.getByKind("web-service");
  const byAlias = all.filter((c) => aliasOf(c) === configRef);
  if (byAlias.length === 1) return { ok: true, config: byAlias[0] };
  if (byAlias.length > 1) return { ok: false, reason: "AMBIGUOUS_ALIAS" };
  return { ok: false, reason: "UNKNOWN_CONFIG" };
}

/** Why a configuration is published under the address it is. */
export type AddressReason =
  /** It has a usable alias. */
  | "alias"
  /** It has no alias at all. */
  | "no-alias"
  /** Its alias names more than one configuration, so the dispatcher refuses it. */
  | "ambiguous-alias"
  /** Another configuration's id is spelled the same as this alias, and id wins. */
  | "alias-shadowed-by-id";

export interface ServiceAddress {
  /** The URL segment to publish. */
  value: string;
  /** True when the address is the configuration's id rather than an alias. */
  isDatabaseId: boolean;
  reason: AddressReason;
}

/**
 * The address that reaches `config`, given every web service configuration in
 * this database — the exact inverse of {@link resolveConfiguration}.
 *
 * An alias is published only when the dispatcher would actually resolve it
 * back to this same record. Otherwise the id is published: it is uglier and it
 * does not travel between environments, but it is the address that WORKS, and
 * an address that works beats one that reads well.
 */
export function addressForConfig(
  config: PluginConfig,
  allWebServiceConfigs: PluginConfig[],
): ServiceAddress {
  const alias = aliasOf(config);
  if (!alias) return { value: config.id, isDatabaseId: true, reason: "no-alias" };

  const owners = allWebServiceConfigs.filter((c) => aliasOf(c) === alias);
  if (owners.length > 1) {
    return { value: config.id, isDatabaseId: true, reason: "ambiguous-alias" };
  }
  if (allWebServiceConfigs.some((c) => c.id === alias)) {
    return { value: config.id, isDatabaseId: true, reason: "alias-shadowed-by-id" };
  }

  return { value: alias, isDatabaseId: false, reason: "alias" };
}
