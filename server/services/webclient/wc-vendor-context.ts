import { storage } from "../../storage";
import { getWcVendorHandler, getWcVendorPlugin } from "../../plugins/wc-vendors/registry";
import type {
  RegisteredWcVendorPlugin,
  WcVendorOperationInfo,
  WcVendorOperationName,
  WcVendorOperationResult,
  WcVendorContext,
} from "../../plugins/wc-vendors/types";
import type { PluginConfig } from "@shared/schema";
import {
  getEnvironmentVariable,
  registerEnvironmentVariable,
} from "../../config/env-registry";
import {
  WcVendorError,
  WcVendorNoAssignedOperationError,
  WcVendorRequestError,
} from "../../plugins/wc-vendors/errors";
import {
  assertExternalServiceAllowed,
  isMaintenanceModeError,
} from "../maintenance-flag";
import { wcCacheStorage } from "../../storage/wc-cache";
import { notRecordableReason } from "./refusals";
import type {
  WcTransportRequestOptions,
  WcVendorRequestOptions,
  WcVendorTarget,
} from "./client";
import type { WcAnswer, WcRequestMode, WcResult } from "./types";
import { isPluginComponentEnabledAsync } from "../../plugins/_core/gating";

/**
 * The vendor half of the web client framework.
 *
 * `wcRequest` in `client.ts` owns the decisions every outbound request shares —
 * the cache, the maintenance refusal, the writable-database gate, the usage
 * count — and knows nothing about vendor plugins. This file knows about
 * plugins and nothing about those decisions: it turns "this connection, this
 * operation" into a resolved credential and a handler, and hands the call back
 * to the core through the transport it is given. Neither half imports the
 * other at module load; the core reaches this one through a dynamic import.
 */

/**
 * A gateway config resolved into everything a call needs: the config row, the
 * registered plugin, and a provider context carrying the per-config credential.
 *
 * Framework-internal. The credential in here is the whole reason this type
 * does not leave the file — a domain caller gets a
 * {@link WcVendorDescription}, which carries no credential at all.
 */
interface ResolvedWcVendor {
  config: PluginConfig;
  plugin: RegisteredWcVendorPlugin;
  context: WcVendorContext;
}

/** The framework's core, as this half calls it. */
type WcTransport = <TValue>(
  options: WcTransportRequestOptions<TValue>,
) => Promise<WcResult<TValue>>;

/** The config, plugin or credential could not be resolved. */
export class WcVendorResolutionError extends WcVendorError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "WcVendorResolutionError";
  }
}

// Raised inside the kind, caught out here: a route wants one name for "the
// provider was not reached", whatever the reason.
export {
  WcVendorError,
  WcVendorNoAssignedOperationError,
  WcVendorRequestError,
};

/** No enabled connection exists for the plugin a caller named. */
export class WcVendorNoDefaultError extends WcVendorResolutionError {
  constructor(public readonly pluginId: string) {
    super(
      503,
      `No enabled '${pluginId}' connection is configured. Add one on the webclient vendors page.`,
    );
    this.name = "WcVendorNoDefaultError";
  }
}

/** Several enabled connections exist and none of them is the obvious one. */
export class WcVendorAmbiguousDefaultError extends WcVendorResolutionError {
  constructor(
    public readonly pluginId: string,
    public readonly configIds: string[],
  ) {
    super(
      409,
      `This site has ${configIds.length} enabled '${pluginId}' connections, so there is no single default to use. ` +
        `Leave exactly one enabled, or name the connection explicitly.`,
    );
    this.name = "WcVendorAmbiguousDefaultError";
  }
}

/**
 * What a caller may know about a connection: which one it is, which vendor is
 * behind it, what gating it carries and what it can be asked to do.
 *
 * Everything a domain module legitimately needs — a component gate, a "can
 * this vendor even do that" check, a plugin id to show — and nothing it does
 * not. There is deliberately no handler and no credential on here: the only
 * way to make the call is to ask the framework to make it.
 */
export interface WcVendorDescription {
  configId: string;
  configName: string | null;
  pluginId: string;
  pluginName: string;
  /** Component that must be enabled for this vendor to be used. */
  requiredComponent?: string;
  /** Client component id for the vendor's own add-a-payment-method form. */
  addComponentId?: string;
  /** Operations this vendor declares. */
  operations: WcVendorOperationName[];
}

/**
 * Turn a config id into a {@link ResolvedWcVendor}. Resolves the provider
 * credential from the secret the config names (`data.secretName`, read via the
 * env registry), so multiple configs (e.g. two Stripe accounts) each use their
 * own credentials.
 */
async function resolveWcVendor(gatewayConfigId: string): Promise<ResolvedWcVendor> {
  const config = await storage.pluginConfigs.get(gatewayConfigId);
  if (!config || config.pluginKind !== "wc-vendors") {
    throw new WcVendorResolutionError(404, "Vendor configuration not found");
  }
  if (!config.enabled) {
    throw new WcVendorResolutionError(409, "Vendor configuration is disabled");
  }

  const plugin = getWcVendorPlugin(config.pluginId);
  if (!plugin) {
    throw new WcVendorResolutionError(
      404,
      `No vendor plugin registered for '${config.pluginId}'`,
    );
  }
  if (!(await isPluginComponentEnabledAsync(plugin))) {
    throw new WcVendorResolutionError(
      403,
      `Component '${plugin.requiredComponent}' not enabled`,
    );
  }

  const data = (config.data ?? {}) as Record<string, unknown>;
  const requirement = plugin.credential.secretName;
  const secretName =
    typeof data.secretName === "string" ? data.secretName.trim() : "";
  if (!secretName && requirement === "required") {
    throw new WcVendorResolutionError(
      503,
      "Vendor configuration does not name a credential secret",
    );
  }

  if (!secretName || requirement === "none") {
    return {
      config,
      plugin,
      context: { credential: { value: "" }, config },
    };
  }

  // Dynamically-named credential: register in the env registry at resolve
  // time (as a secret) so the environment contract stays complete.
  // changeTakesEffect: "immediate" — the vendor is resolved afresh per
  // request and the credential is read here each time, never cached.
  //
  // The category is "webclient", not the domain of whatever the vendor
  // happens to do. Registration here is last-write-wins, so declaring a
  // domain would let the first vendor resolved stamp its own domain on every
  // other vendor's credential; and since the kind stopped being ledger-owned,
  // a vendor that has nothing to do with payments must not have its secret
  // filed under the ledger.
  registerEnvironmentVariable({
    name: secretName,
    description: `Vendor credential secret named by config '${config.siriusId ?? config.id}'.`,
    secret: true,
    category: "webclient",
    changeTakesEffect: "immediate",
  });
  const credentialValue = getEnvironmentVariable(secretName);
  if (!credentialValue && requirement === "required") {
    throw new WcVendorResolutionError(
      503,
      `Vendor credential secret '${secretName}' is not set`,
    );
  }

  return {
    config,
    plugin,
    context: {
      credential: { secretName, value: credentialValue ?? "" },
      config,
    },
  };
}

/**
 * Resolve the connection to use when the caller names a vendor but no
 * particular configuration of it.
 *
 * The default is the one enabled configuration of that plugin. Not the first of
 * several by some ordering: a caller reaching this function is one that has
 * never chosen a connection, and quietly handing it whichever row sorts first
 * is how a site with two connections ends up syncing both into the same place.
 * The T631 worker sync makes that concrete — it deactivates every worker absent
 * from the response it was given, so two connections taking turns would each
 * deactivate the other's workers. Refusing an ambiguous default is what stops
 * that, which is why more-than-one is an error here and not a preference.
 *
 * Every default resolution goes through this one function. A later "a different
 * default per operation" grows here, where the ambiguity rule already lives,
 * rather than in each caller.
 */
async function resolveDefaultWcVendor(pluginId: string): Promise<ResolvedWcVendor> {
  const enabled = (
    await storage.pluginConfigs.getByKindAndPlugin("wc-vendors", pluginId)
  ).filter((config) => config.enabled);

  if (enabled.length === 0) throw new WcVendorNoDefaultError(pluginId);
  if (enabled.length > 1) {
    throw new WcVendorAmbiguousDefaultError(
      pluginId,
      enabled.map((config) => config.id),
    );
  }
  return resolveWcVendor(enabled[0].id);
}

function hasAssignedOperation(
  config: PluginConfig,
  operation: WcVendorOperationName,
): boolean {
  const data =
    config.data && typeof config.data === "object"
      ? (config.data as Record<string, unknown>)
      : {};
  return (
    Array.isArray(data.operations) &&
    data.operations.some((assigned) => assigned === operation)
  );
}

function hasDeclaredAssignedOperation(
  config: PluginConfig,
  operation: WcVendorOperationName,
): boolean {
  return (
    hasAssignedOperation(config, operation) &&
    Boolean(getWcVendorPlugin(config.pluginId)?.operations[operation])
  );
}

async function keepComponentEnabledConfigs(
  configs: PluginConfig[],
): Promise<PluginConfig[]> {
  const enabled = await Promise.all(
    configs.map(async (config) => {
      const plugin = getWcVendorPlugin(config.pluginId);
      return plugin && (await isPluginComponentEnabledAsync(plugin))
        ? config
        : undefined;
    }),
  );
  return enabled.filter((config): config is PluginConfig => Boolean(config));
}

/**
 * Resolve the one enabled connection assigned to a particular operation.
 *
 * Assignments live in each config's data, so an unassigned config is not an
 * `any` candidate even when its plugin declares the operation. This makes the
 * generic config editor's operation list the authoritative routing choice.
 */
async function resolveAnyWcVendor(
  operation: WcVendorOperationName,
): Promise<ResolvedWcVendor> {
  const configs = (
    await storage.pluginConfigs.getByKind("wc-vendors")
  ).filter((config) => config.enabled);
  const assigned = configs.filter((config) =>
    hasDeclaredAssignedOperation(config, operation),
  );
  const candidates = await keepComponentEnabledConfigs(assigned);

  if (candidates.length === 0) {
    // Preserve the specific component refusal when there is one otherwise
    // unambiguous route. With several unusable assignments there is no single
    // connection whose refusal can truthfully explain the route as a whole.
    if (assigned.length === 1) return resolveWcVendor(assigned[0].id);
    throw new WcVendorNoAssignedOperationError(operation);
  }
  if (candidates.length > 1) {
    throw new WcVendorRequestError(
      409,
      `Multiple enabled webclient vendor configurations are assigned to '${operation}' ` +
        `(${candidates.map((config) => config.id).join(", ")}); ` +
        `assign only one or select a connection explicitly.`,
    );
  }
  return resolveWcVendor(candidates[0].id);
}

/** Resolve whichever way the caller addressed the connection. */
function resolveTarget(
  target: WcVendorTarget,
  operation: WcVendorOperationName,
): Promise<ResolvedWcVendor> {
  if ("configId" in target) {
    return resolveWcVendor(target.configId as string);
  }
  if ("pluginId" in target) {
    return resolveDefaultWcVendor(target.pluginId as string);
  }
  return resolveAnyWcVendor(operation);
}

/**
 * What a connection is, for a caller that needs to decide something before
 * asking for anything: whether its component is enabled, whether the vendor
 * behind it can do the thing at all, what to show on a page.
 *
 * Resolves exactly as a request does, refusals included — a connection that is
 * missing, disabled, unregistered or short a credential is reported here in the
 * same words and with the same status as it would be at call time, so a caller
 * that describes before it calls does not get two different answers.
 */
export async function describeWcVendor(
  target: WcVendorTarget,
  operation?: WcVendorOperationName,
): Promise<WcVendorDescription> {
  if ("any" in target && !operation) {
    throw new WcVendorRequestError(
      400,
      "An operation is required when describing an any webclient vendor target.",
    );
  }
  const { config, plugin } = await resolveTarget(target, operation!);
  return {
    configId: config.id,
    configName: config.name ?? null,
    pluginId: plugin.id,
    pluginName: plugin.name,
    requiredComponent: plugin.requiredComponent,
    addComponentId: plugin.addComponentId,
    operations: Object.keys(plugin.operations) as WcVendorOperationName[],
  };
}

function requireRegisteredPlugin(pluginId: string): RegisteredWcVendorPlugin {
  const plugin = getWcVendorPlugin(pluginId);
  if (!plugin) {
    throw new WcVendorResolutionError(
      404,
      `No vendor plugin registered for '${pluginId}'`,
    );
  }
  return plugin;
}

function requireOperation(
  plugin: RegisteredWcVendorPlugin,
  name: WcVendorOperationName,
): WcVendorOperationInfo {
  const declaration = plugin.operations[name];
  if (!declaration) {
    throw new WcVendorRequestError(
      501,
      `Vendor '${plugin.name}' does not support '${name}'`,
    );
  }
  return declaration;
}

/**
 * Assignment check for an operation-scoped (any) target. This inspects only
 * enabled config rows, their stored assignments, and plugin declarations; it
 * never resolves credentials or contacts a provider.
 */
export async function hasWcVendorOperation(
  operation: WcVendorOperationName,
): Promise<boolean> {
  const configs = (
    await storage.pluginConfigs.getByKind("wc-vendors")
  ).filter((config) => config.enabled);
  const assigned = configs.filter((config) =>
    hasDeclaredAssignedOperation(config, operation),
  );
  const candidates = await keepComponentEnabledConfigs(assigned);
  return candidates.length === 1;
}

/**
 * Refuse now, if the site is in maintenance and this plugin talks to an
 * outside system.
 *
 * Asked as early as the service is known, which for a caller naming a plugin
 * id is before any configuration is read. That matters: "the site is in
 * maintenance" is true of a site whether or not its connections are set up,
 * and a refusal that first needed a resolvable connection would report an
 * unconfigured site instead of a closed one.
 *
 * It is asked here ONLY for that reason. The refusal that covers the call
 * itself is the core's, made on the one path that makes a call, so a caller
 * naming a connection rather than a plugin is refused there and is not asked
 * twice here.
 */
function refuseDuringMaintenance(
  plugin: RegisteredWcVendorPlugin,
  declaration: WcVendorOperationInfo,
): void {
  if (plugin.service) {
    assertExternalServiceAllowed(plugin.service, declaration.description);
  }
}

/**
 * Whether this request is going to ask the far end anything.
 *
 * `local` and `cached-only` are answers about what we already have: the core
 * reads no network on either, so nothing about them is refused during
 * maintenance and nothing about them runs a handler. Deciding it here as well
 * keeps the two halves saying the same thing — the vendor half refuses before
 * the core is reached, and refusing a request the core would never have made
 * would report a closed site to a caller that only wanted a normalized
 * argument.
 */
function willReachTheFarEnd(mode: WcRequestMode | undefined): boolean {
  return mode !== "local" && mode !== "cached-only";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ask a vendor plugin to do one of the things it declares.
 *
 * Called only by `wcRequest`, which is the door every caller uses. What this
 * adds to the core is the part that is specific to a plugin: which connection,
 * which credential, which handler, and the refusals that belong to addressing
 * a vendor at all.
 *
 * Those refusals throw, and the far end's behaviour does not. "There is no such
 * connection", "there is no single default", "this vendor cannot do that" and
 * "the site is closed" are all statements about US, made before anything left
 * the building; a caller that treated one as a vendor failure would report the
 * vendor as unwell when nobody asked it anything. Whatever the vendor itself
 * did comes back in the result, with the provider's own error object on
 * `cause` for the callers that read it.
 */
export async function runWcVendorRequest<N extends WcVendorOperationName>(
  options: WcVendorRequestOptions<N>,
  transport: WcTransport,
): Promise<WcResult<WcVendorOperationResult<N>>> {
  const { vendor, operation: name, args } = options;
  const calling = willReachTheFarEnd(options.mode);

  // Before the database is touched, when the caller named the vendor itself.
  if (vendor.pluginId !== undefined) {
    const known = requireRegisteredPlugin(vendor.pluginId);
    const declared = requireOperation(known, name);
    // An uncached operation can only answer by calling, so refuse before even
    // resolving its default connection. A cached operation may already have an
    // answer: let the core inspect the cache first and refuse only if it would
    // actually reach the far end.
    if (calling && declared.cacheMode === "uncached") {
      refuseDuringMaintenance(known, declared);
    }
  }

  const resolved = await resolveTarget(vendor, name);
  const declaration = requireOperation(resolved.plugin, name);

  const handler = getWcVendorHandler(resolved.plugin.id, name);
  if (!handler) {
    throw new WcVendorRequestError(
      501,
      `Vendor '${resolved.plugin.name}' declares '${name}' but registered no handler for it`,
    );
  }
  const run = () => handler(resolved.context, args as never);

  // No outside system: there is nothing to refuse, nothing to count and no
  // vendor to name, so the core — which is built around all three — has no
  // work to do, and has no registered behavior to do it from. The two
  // decisions that still apply are the caller's mode and whether the answer
  // can be written down, because an in-process vendor can change state too.
  if (!resolved.plugin.service) {
    // Nothing is ever stored for an operation like this, so "only what is
    // stored" and "nothing outside this process" are the same empty answer the
    // core gives — and neither one runs the handler.
    if (!calling) return { source: "none", fresh: false };
    if (declaration.needsWritableDatabase && !(await wcCacheStorage.canStore())) {
      return {
        source: "none",
        fresh: false,
        error: notRecordableReason(resolved.plugin.name, declaration.description),
      };
    }
    try {
      return {
        source: "network",
        outcome: "success",
        fresh: true,
        value: (await run()) as WcVendorOperationResult<N>,
        fetchedAt: new Date(),
      };
    } catch (thrown) {
      if (isMaintenanceModeError(thrown)) throw thrown;
      return {
        source: "network",
        outcome: "failure",
        fresh: false,
        error: errorMessage(thrown),
        cause: thrown,
      };
    }
  }

  // Whether the provider failed, tracked separately from the error itself:
  // `undefined` is a value a throw can carry, so the error cannot also be the
  // flag that says there was one.
  let providerFailed = false;
  let providerError: unknown;

  const result = await transport<WcVendorOperationResult<N>>({
    service: resolved.plugin.service,
    requestType: name,
    configurationId: resolved.config.id,
    args: { configId: resolved.config.id, args },
    mode: options.mode,
    fetch: async (): Promise<WcAnswer<WcVendorOperationResult<N>>> => {
      try {
        const answer = await run();
        if (declaration.cacheMode === "cached") {
          if (
            !answer ||
            typeof answer !== "object" ||
            typeof (answer as { answered?: unknown }).answered !== "boolean"
          ) {
            throw new Error(
              `Cached vendor operation '${name}' returned no answer envelope`,
            );
          }
          return answer as WcAnswer<WcVendorOperationResult<N>>;
        }
        return { answered: true, value: answer as WcVendorOperationResult<N> };
      } catch (thrown) {
        // A refusal is the framework's own answer, not the vendor's.
        if (isMaintenanceModeError(thrown)) throw thrown;
        providerFailed = true;
        providerError = thrown;
        return { answered: false, error: errorMessage(thrown) };
      }
    },
  });

  return providerFailed ? { ...result, cause: providerError } : result;
}
