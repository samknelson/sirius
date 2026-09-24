import { PluginRegistry } from "../_core/registry";
import type { TokenPlugin, TokenPluginMetadata, TokenEntityType } from "./types";

export const tokenPluginRegistry = new PluginRegistry<TokenPlugin, TokenPluginMetadata>({
  kind: "token",
  getMetadata: (plugin) => plugin.metadata,
  toManifestEntry: (plugin) => plugin.metadata,
});

let registrations = 0;

type TokenPluginListener = (plugin: TokenPlugin) => void;
const registrationListeners: TokenPluginListener[] = [];

/**
 * Watch registrations. For the parts of the graph that are DERIVED from
 * what other plugins declare (the options relations, generated from an
 * entity table's foreign keys): registration is not a boot-only event —
 * a notifier module imported after the first render registers plugins
 * too — so a derived segment cannot be generated in one pass and then
 * assumed complete, or a late plugin silently has none.
 */
export function onTokenPluginRegistered(listener: TokenPluginListener): void {
  registrationListeners.push(listener);
}

export function registerTokenPlugin(plugin: TokenPlugin): void {
  tokenPluginRegistry.register(plugin);
  registrations++;
  for (const listener of registrationListeners) listener(plugin);
}

/**
 * Bumped by every registration. Derived caches (the field catalog) key
 * themselves on it, so a plugin registered late — a named record root
 * declared by a notifier module imported after the first render — is
 * never missed by a cache built before it existed.
 */
export function tokenRegistryVersion(): number {
  return registrations;
}

/**
 * Same purpose, for a change that alters what a REGISTERED plugin's
 * metadata says (a second surface declaring extra merged fields on a
 * shared named record root) rather than adding a plugin.
 */
export function bumpTokenRegistryVersion(): void {
  registrations++;
}

function segmentMatches(
  plugin: TokenPlugin,
  name: string,
  inputType: TokenEntityType,
): boolean {
  return (
    plugin.metadata.segmentName === name &&
    (plugin.metadata.inputTypes.includes(inputType) ||
      (plugin.metadata.inputTypes.includes("*") &&
        inputType !== "root" &&
        inputType !== "value"))
  );
}

// A hand-written segment always beats a derived one of the same name,
// whichever registered first: the sweep that derived it skips names
// already declared, but a plugin registered after the sweep ran cannot
// be skipped, only deferred to.
function preferHandWritten(matches: TokenPlugin[]): TokenPlugin | undefined {
  return matches.find((p) => !p.metadata.generated) ?? matches[0];
}

/**
 * Resolve which plugin handles a segment name given the current entity
 * type. Segment names are only unique per input type, so lookup is by
 * (name, inputType) — not by registry id. Only component-enabled
 * plugins participate.
 */
export function findSegmentPlugin(
  name: string,
  inputType: TokenEntityType,
): TokenPlugin | undefined {
  return preferHandWritten(
    tokenPluginRegistry
      .listEnabledSync()
      .filter((p) => segmentMatches(p, name, inputType)),
  );
}

/**
 * The same lookup over EVERY registered plugin, switched-on or not.
 *
 * A segment whose component is switched off is not an unknown segment:
 * it is a real part of the graph this deployment currently has no data
 * for. Telling the two apart is what lets a stored template naming it
 * keep validating (and render blank) instead of being condemned as a
 * typo the moment an admin flips a component off.
 */
export function findRegisteredSegmentPlugin(
  name: string,
  inputType: TokenEntityType,
): TokenPlugin | undefined {
  return preferHandWritten(
    tokenPluginRegistry.list().filter((p) => segmentMatches(p, name, inputType)),
  );
}
